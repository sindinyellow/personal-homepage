---
title: 'HIS 医院信息系统 -- 实习期间的排班、挂号与签到开发实践'
description: '实习期间独立负责医生排班、预约挂号、预约签到三个核心模块的前后端开发，涉及 CAS 并发控制、DDD 分层架构和复杂 SQL 设计。'
pubDate: '2026-04-28'
tags: ['项目复盘', 'Spring Boot', 'Vue', 'PostgreSQL', '实习']
---

> **项目类型**：医院信息管理系统（HIS, Hospital Information System）
> **技术栈**：Spring Boot + MyBatis-Plus + PostgreSQL | Vue 3 + Element Plus
> **架构风格**：DDD 分层架构（Controller → AppService → Domain Service → Mapper）
> **开发周期**：2026年1月 -- 2026年4月（实习期间）
> **个人职责**：独立负责医生排班、预约挂号、预约签到三个核心模块的前后端开发

## 项目背景

本项目是一套面向医院门诊场景的信息管理系统（OpenHIS），涵盖挂号收费、门诊医生站、预约管理、医保结算等模块。系统采用多租户架构，支持多家医院同时使用，通过 `tenant_id` 进行数据隔离。

我实习期间主要负责**预约管理子系统**的三个核心功能模块：

| 模块 | 核心职责 | 用户角色 |
|------|---------|---------|
| 医生排班 | 管理医生出诊时间、诊室、限号数量、费用 | 科室管理员 |
| 预约挂号 | 号源展示、患者预约、取消预约 | 患者 / 挂号员 |
| 预约签到 | 患者到院签到、自动预结算、收费确认 | 收费员 |

三个模块构成一条完整的业务链路：**排班生成号源 → 患者预约消耗号源 → 到院签到完成就诊**。

### DDD 分层架构

系统采用领域驱动设计的分层架构，每一层职责清晰：

```
┌─────────────────────────────────────────────────────────┐
│  Controller 层                                           │
│  接收 HTTP 请求，参数校验，调用 AppService，返回统一响应    │
│  不包含任何业务逻辑                                       │
├─────────────────────────────────────────────────────────┤
│  AppService 层（应用服务层）                              │
│  编排领域服务，管理事务边界，处理跨模块调用                 │
│  业务逻辑的核心编排层                                     │
├─────────────────────────────────────────────────────────┤
│  Domain Service 层（领域服务层）                          │
│  封装单个领域的核心业务规则                                │
│  如：号源状态流转、排班冲突检测                            │
├─────────────────────────────────────────────────────────┤
│  Mapper 层（数据访问层）                                  │
│  MyBatis-Plus Mapper 接口 + XML SQL 映射                  │
│  负责数据库 CRUD 和复杂查询                               │
└─────────────────────────────────────────────────────────┘
```

**实际开发中的分层示例**：预约挂号流程中，Controller 接收请求后调用 `TicketAppServiceImpl.bookTicket()`，该方法编排了取消次数检查（调用配置服务）、号源校验（调用 Mapper）、CAS 抢占（调用 Mapper）、创建订单（调用订单服务）、刷新统计（调用 Mapper）等多个步骤，每个步骤职责单一。

```
┌──────────────┐    生成号源    ┌──────────────┐    消耗号源    ┌──────────────┐
│  医生排班     │ ──────────→  │  预约挂号     │ ──────────→  │  预约签到     │
│  (管理员)     │              │  (患者/挂号员) │              │  (收费员)     │
└──────────────┘              └──────────────┘              └──────────────┘
   排班模板                       号源槽位                      号源池统计
   ↓                              ↓                            ↓
   号源池 + 号源槽                订单创建                      状态归档
```

## 核心领域模型 -- 号源三层结构

这是整个系统最关键的架构设计。号源不是单一的扁平概念，而是由三层结构组成：

```
┌──────────────────────────────────────────────────────────────┐
│  第一层：排班模板 (adm_doctor_schedule)                        │
│  定义"规则"：哪个医生、星期几、上午/下午、限号多少               │
│  设置一次即可按星期循环使用                                     │
└───────────────────────┬──────────────────────────────────────┘
                        │ 创建排班时实例化到具体日期
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  第二层：号源池 (adm_schedule_pool)                            │
│  定义"实例"：具体某天的出诊计划                                 │
│  聚合根 -- 管理统计信息：总号量、已约数、锁定数、剩余号数         │
│  剩余号数 = total_quota - booked_num - locked_num              │
│  (数据库生成列，自动计算)                                       │
└───────────────────────┬──────────────────────────────────────┘
                        │ 按限号数量拆分为 N 个槽位
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  第三层：号源槽位 (adm_schedule_slot)                          │
│  并发控制的最小单元：每个患者预约锁一个槽位，互不干扰             │
│  包含：序号、预计叫号时间、状态、关联订单、签到时间               │
└──────────────────────────────────────────────────────────────┘
```

**为什么这样设计？**

| 层级 | 定位 | 设计意图 |
|------|------|---------|
| 排班模板 | "规则层" | 一次配置循环使用，避免每天重复排班 |
| 号源池 | "聚合根" | 余号查询只需查号源池，无需遍历槽位；管理统计信息 |
| 号源槽位 | "并发控制层" | 粒度精确到单个号源，CAS 原子抢占互不干扰 |

### 号源槽位状态机

号源槽位是整个系统状态流转的核心，定义了 6 种状态：

```text
  AVAILABLE(0) ──── 预约 ────→ BOOKED(1) ──── 签到 ────→ CHECKED_IN(4)
       │                         │
       │ 取消                    │ 退号
       ▼                         ▼
  CANCELLED(2)              RETURNED(5)

  任意状态 ──── 停诊 ────→ CANCELLED(2)
```

```java
// CommonConstants.java
public interface SlotStatus {
    Integer AVAILABLE  = 0;  // 可用 / 待预约
    Integer BOOKED     = 1;  // 已预约
    Integer CANCELLED  = 2;  // 已取消 / 已停诊
    Integer LOCKED     = 3;  // 已锁定（预约进行中）
    Integer CHECKED_IN = 4;  // 已签到 / 已取号
    Integer RETURNED   = 5;  // 已退号
}
```

## 医生排班模块

### 排班创建流程

排班创建是一个三层联动的事务操作，排班主记录、号源池、号源槽位在同一个事务中完成：

```
新增排班请求
      │
      ▼
┌─────────────────────┐
│  ① 参数校验          │  必填字段、限号数量 > 0、结束时间 > 开始时间
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  ② 时间重叠检查      │  同一医生同一天不能有重叠时段
│  startA < endB       │
│  AND startB < endA   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  ③ 保存排班主记录    │  adm_doctor_schedule
│  insertWithoutId     │  数据库 GENERATED ALWAYS 自增ID
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  ④ 创建号源池        │  adm_schedule_pool
│  生成唯一 pool_code  │  包含医生、诊室、日期、费用
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  ⑤ 批量创建号源槽位  │  adm_schedule_slot
│  按限号数量拆分      │  均匀分布预计叫号时间
└─────────────────────┘
```

核心代码：

```java
// DoctorScheduleAppServiceImpl.addDoctorScheduleWithDate
LocalDate scheduleDate = LocalDate.parse(scheduledDate);
boolean hasOverlap = checkTimeOverlap(
    doctorSchedule.getDoctorId(), scheduleDate,
    doctorSchedule.getStartTime(), doctorSchedule.getEndTime()
);
if (hasOverlap) {
    return R.fail("该医生在 " + scheduledDate + " 的 "
        + doctorSchedule.getStartTime() + "-" + doctorSchedule.getEndTime()
        + " 时间段与已有排班重叠，不能重复添加");
}

DoctorSchedule newSchedule = new DoctorSchedule();
int result = doctorScheduleMapper.insertWithoutId(newSchedule);

SchedulePool pool = createSchedulePoolWithDate(newSchedule, doctorSchedule.getDoctorId(), scheduledDate);
schedulePoolService.save(pool);

List<ScheduleSlot> slots = createScheduleSlots(
    pool.getId().intValue(),
    newSchedule.getLimitNumber(),
    newSchedule.getStartTime(),
    newSchedule.getEndTime()
);
scheduleSlotService.saveBatch(slots);
```

### 号源槽位时间计算

每个号源槽位的预计叫号时间在 [startTime, endTime] 之间均匀分布：

```java
long totalTimeMinutes = startTime.until(endTime, ChronoUnit.MINUTES);
long interval = totalTimeMinutes / limitNumber;

for (int i = 1; i <= limitNumber; i++) {
    ScheduleSlot slot = new ScheduleSlot();
    slot.setPoolId(poolId);
    slot.setSeqNo(i);
    slot.setStatus(0);  // AVAILABLE
    LocalTime expectTime = startTime.plusMinutes(interval * (i - 1));
    slot.setExpectTime(expectTime);
    slots.add(slot);
}
// 例：08:00-12:00，限号20个 → 每12分钟一个号
// 号1=08:00, 号2=08:12, 号3=08:24 ... 号20=11:48
```

### 时间重叠校验

使用经典的区间相交判定公式：

```java
private boolean checkTimeOverlap(Long doctorId, LocalDate scheduleDate,
                                  LocalTime startTime, LocalTime endTime) {
    return schedulePoolService.lambdaQuery()
        .eq(SchedulePool::getDoctorId, doctorId)
        .eq(SchedulePool::getScheduleDate, scheduleDate)
        .lt(SchedulePool::getStartTime, endTime)    // startA < endB
        .gt(SchedulePool::getEndTime, startTime)    // startB < endA
        .exists();
}
```

### 按星期批量排班

除单日排班外，系统支持"按星期排班"模式——设置一次规则后，自动在未来 N 周内按星期循环生成排班：

```java
// DoctorScheduleAppServiceImpl.addDoctorScheduleWithWeekday
LocalDate startDate = LocalDate.now();
LocalDate endDate = startDate.plusWeeks(weeks);  // 默认生成4周

// 遍历日期范围，匹配星期
for (LocalDate date = startDate; !date.isAfter(endDate); date = date.plusDays(1)) {
    if (date.getDayOfWeek() == targetWeekday) {
        // 检查该日期是否已有排班
        boolean exists = checkScheduleExists(doctorId, date, startTime, endTime);
        if (!exists) {
            // 复用单日排班逻辑：创建排班 → 号源池 → 号源槽位
            addDoctorScheduleWithDate(doctorSchedule, date.toString());
        }
    }
}
```

### 停诊处理

当医生临时停诊时，需要级联更新所有关联数据：

```
停诊请求
    │
    ▼
┌─────────────────────────────┐
│  ① 更新排班主记录 is_stopped │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  ② 查找关联的号源池          │
│  遍历所有号源槽位            │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  ③ 槽位状态更新              │
│  AVAILABLE → CANCELLED       │
│  BOOKED    → 保持不变        │
│  (已预约的患者需要通知取消)   │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  ④ 刷新号源池统计            │
│  重新计算 available_num      │
└─────────────────────────────┘
```

### 更新排班时的同步机制

更新排班后，自动同步更新关联的号源池信息，避免联表查询时数据不一致：

```java
if (needSyncPool) {
    schedulePoolService.lambdaUpdate()
        .eq(SchedulePool::getScheduleId, doctorSchedule.getId())
        .set(doctorSchedule.getDoctor() != null,
             SchedulePool::getDoctorName, doctorSchedule.getDoctor())
        .set(doctorSchedule.getClinic() != null,
             SchedulePool::getClinicRoom, doctorSchedule.getClinic())
        .set(doctorSchedule.getLimitNumber() != null,
             SchedulePool::getTotalQuota, doctorSchedule.getLimitNumber())
        .update();
}
```

### 删除排班的级联逻辑

排班删除是三层级联逻辑删除，在同一个事务中完成：

```
排班ID → 查号源池列表 → 查号源槽列表 → 逻辑删除槽 → 逻辑删除池 → 逻辑删除排班
```

## 预约挂号模块

### 预约流程 -- 四道防线

预约流程是整个系统中最核心的业务逻辑，采用了四道防线保证数据安全和一致性：

```
患者双击号源卡片
      │
      ▼
┌─────────────────────────────────┐
│  防线一：取消次数限制检查          │
│  检查患者在当前周期内的取消次数    │
│  支持按年/月/日三种周期配置        │
│  超限则拒绝预约                   │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  防线二：直查物理底座              │
│  不信任前端数据，从数据库查询号源  │
│  校验状态、医生是否停诊           │
│  快速失败，避免不必要的 CAS 操作   │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  防线三：CAS 原子抢占              │
│  UPDATE slot SET status=1        │
│  WHERE id=? AND status=0         │
│  返回0行 → "手慢了！"             │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  防线四："绝对防御"数据强覆盖      │
│  关键字段全部以数据库为准          │
│  科室、医生、费用、号源类型        │
│  防止前端被篡改提交虚假数据        │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  创建预约订单 (order_main)        │
│  回填订单ID到号源槽位             │
│  刷新号源池统计                   │
└─────────────────────────────────┘
```

### CAS 原子抢占

这是预约模块最核心的技术点。使用 `UPDATE ... WHERE status = 0` 实现无锁并发控制：

```java
int lockRows = scheduleSlotMapper.lockSlotForBooking(slotId);
if (lockRows <= 0) {
    throw new RuntimeException("手慢了！该号源已刚刚被他人抢占");
}
```

对应的 SQL：

```xml
<update id="lockSlotForBooking">
    UPDATE adm_schedule_slot
    SET status = 1, update_time = now()
    WHERE id = #{slotId}
      AND status = 0
      AND delete_flag = '0'
</update>
```

**为什么用 CAS 而不是悲观锁？**

| 对比维度 | CAS 乐观锁 | 悲观锁 (SELECT FOR UPDATE) |
|---------|-----------|--------------------------|
| 锁开销 | 无锁开销，吞吐量高 | 需要数据库行锁，吞吐量低 |
| 冲突处理 | 失败快速返回 | 等待锁释放 |
| 适用场景 | 并发高但冲突率低 | 冲突率高 |
| 预约场景 | 不同患者抢不同号源，冲突率低 | 不适合 |

### "绝对防御"数据强覆盖

即使前端 DTO 中携带了 `fee`、`regType` 等字段，后端也会强制以数据库查询结果覆盖。这是医疗系统对数据准确性的极致要求 -- 防止前端被篡改后提交虚假数据：

```java
// 【绝对防御】：强制覆盖！不管前端 DTO 传了什么，全以底层数据库物理表为准！
Map<String, Object> safeParams = new HashMap<>();
safeParams.put("departmentId", slot.getDepartmentId());
safeParams.put("departmentName", slot.getDepartmentName());
safeParams.put("doctorId", slot.getDoctorId());
safeParams.put("doctorName", slot.getDoctor());
safeParams.put("fee", toBigDecimal(slot.getFee()));
safeParams.put("regType", slot.getRegType() != null && slot.getRegType() == 1 ? "专家" : "普通");
```

### 取消预约

取消预约同样需要保证数据一致性。流程：校验槽位状态 → 更新订单状态 → 释放号源 → 刷新统计：

```java
@Transactional(rollbackFor = Exception.class)
public int cancelTicket(Long slotId) {
    TicketSlotDTO slot = scheduleSlotMapper.selectTicketSlotById(slotId);
    if (slot == null) {
        throw new RuntimeException("号源槽位不存在");
    }
    if (slot.getSlotStatus() == null || !SlotStatus.BOOKED.equals(slot.getSlotStatus())) {
        throw new RuntimeException("号源不可取消预约");
    }

    // 1. 更新订单状态为已取消
    orderService.updateOrderStatusById(slot.getOrderId(),
        AppointmentOrderStatus.CANCELLED);

    // 2. 释放号源槽位：状态回退为可用
    scheduleSlotMapper.updateSlotStatus(slotId, SlotStatus.AVAILABLE);

    // 3. 刷新号源池统计
    refreshPoolStatsBySlotId(slotId);
    return 1;
}
```

### 取消次数限制

取消次数限制在**预约时**检查（而非取消时），目的是在源头拦截恶意占号行为。支持按 YEAR/MONTH/DAY 三种周期配置：

```java
AppointmentConfig config = appointmentConfigService.getConfigByTenantId(tenantId);
if (config != null && config.getCancelAppointmentCount() != null
        && config.getCancelAppointmentCount() > 0) {
    LocalDateTime startTime = calculatePeriodStartTime(config.getCancelAppointmentType());
    long cancelledCount = orderService.countPatientCancellations(patientId, tenantId, startTime);
    if (cancelledCount >= config.getCancelAppointmentCount()) {
        throw new RuntimeException("由于您在" + periodName + "内累计取消预约已达"
            + cancelledCount + "次，触发系统限制，暂时无法在线预约");
    }
}
```

### 号源池统计刷新

号源池统计使用子查询实时重算，而不是简单的 +1/-1，避免并发场景下计数漂移：

```java
@Update("""
    UPDATE adm_schedule_pool p
    SET
        booked_num = COALESCE((
            SELECT COUNT(1) FROM adm_schedule_slot s
            WHERE s.pool_id = p.id AND s.delete_flag = '0' AND s.status = 1
        ), 0),
        locked_num = COALESCE((
            SELECT COUNT(1) FROM adm_schedule_slot s
            WHERE s.pool_id = p.id AND s.delete_flag = '0' AND s.status = 3
        ), 0),
        update_time = now()
    WHERE p.id = #{poolId} AND p.delete_flag = '0'
    """)
int refreshPoolStats(@Param("poolId") Long poolId);
```

## 预约签到模块

### 签到流程

签到涉及三张表的状态联动更新，在同一个事务中完成：

```java
@Transactional(rollbackFor = Exception.class)
public int checkInTicket(Long slotId) {
    // 1. 查询该槽位关联的订单
    List<Order> orders = orderService.selectOrderBySlotId(slotId);
    Order latestOrder = orders.get(0);

    // 2. 更新订单状态为已取号
    orderService.updateOrderStatusById(latestOrder.getId(),
        AppointmentOrderStatus.CHECKED_IN);

    // 3. 更新支付状态为已支付，记录支付时间
    orderMapper.updatePayStatus(latestOrder.getId(), 1, new Date());

    // 4. 更新号源槽位状态为已签到，记录签到时间
    scheduleSlotMapper.updateSlotStatusAndCheckInTime(slotId,
        SlotStatus.CHECKED_IN, new Date());

    // 5. 更新号源池统计：锁定数-1，已预约数+1
    ScheduleSlot slot = scheduleSlotMapper.selectById(slotId);
    if (slot != null && slot.getPoolId() != null) {
        schedulePoolMapper.updatePoolStatsOnCheckIn(slot.getPoolId());
    }
    return 1;
}
```

### 前端防串单设计

签到流程涉及多个异步步骤（预结算 → 收费弹窗 → 支付回调），前端通过 `currentSlotId` ref 做防串单，形成"一次性令牌"模式：

```javascript
// 开始新签到时，先清理历史值
async function confirmCheckIn() {
    currentSlotId.value = null;  // 清理残留
    // ... 预结算逻辑 ...
    currentSlotId.value = patient.slot_id;  // 预结算成功后才记录
}

// 收费弹窗关闭时
function handleClose(value) {
    if (value == 'success') {
        const pendingSlotId = currentSlotId.value;
        currentSlotId.value = null;  // 消费后立即清空，防止串单
        if (pendingSlotId) {
            checkInTicket(pendingSlotId);
        }
    }
}
```

**设计要点**：`currentSlotId` 在预结算成功后才赋值，在消费后立即清空，防止异步流程中历史数据串入。

### 核心 API 接口

| 接口路径 | 方法 | 功能 | 认证要求 |
|---------|------|------|---------|
| `/appointment/ticket/list` | POST | 分页查询号源列表 | 匿名可访问 |
| `/appointment/ticket/doctorSummary` | POST | 医生余号汇总 | 匿名可访问 |
| `/appointment/ticket/book` | POST | 预约号源 | 需登录 |
| `/appointment/ticket/cancel` | POST | 取消预约 | 需登录 |
| `/appointment/ticket/checkin` | POST | 取号/签到 | 需登录 |
| `/appointment/ticket/cancelConsultation` | POST | 停诊处理 | 需登录 |

号源查询支持匿名访问（`@Anonymous` 注解），方便患者在未登录状态下浏览号源信息。预约和签到操作则需要通过 Spring Security 验证用户身份。

## 门诊退号 -- 跨系统状态同步

当患者在门诊退号时，如果该挂号来源于预约签到，需要同步更新预约系统的状态。使用 try-catch 隔离，退号主流程不依赖预约同步成功：

```java
private void syncAppointmentReturnStatus(Encounter encounter, String reason) {
    try {
        LambdaQueryWrapper<Order> queryWrapper = new LambdaQueryWrapper<Order>()
            .eq(Order::getPatientId, encounter.getPatientId())
            .in(Order::getStatus, AppointmentOrderStatus.BOOKED,
                AppointmentOrderStatus.CHECKED_IN)
            .orderByDesc(Order::getUpdateTime)
            .last("LIMIT 1");

        Order appointmentOrder = orderService.getOne(queryWrapper, false);
        if (appointmentOrder == null) return;

        appointmentOrder.setStatus(AppointmentOrderStatus.RETURNED);
        orderService.updateById(appointmentOrder);
        scheduleSlotMapper.updateSlotStatus(slotId, SlotStatus.RETURNED);
        schedulePoolMapper.refreshPoolStats(poolId);
    } catch (Exception e) {
        log.warn("同步预约号源已退号状态失败", e);  // 异常仅记录，不影响主流程
    }
}
```

## 前端实现

### 门诊预约页 -- 卡片式号源交互

预约页采用**左侧筛选 + 右侧卡片网格**布局，核心交互：

- **双击**未预约卡片 → 打开患者选择弹窗 → 确认预约
- **右键**已预约卡片 → 弹出上下文菜单（取消预约/查看详情）
- 支持按日期、状态、科室、医生、患者姓名多维筛选
- 状态颜色映射：未预约(蓝)、已预约(橙)、已取号(绿)、已停诊(红)、已退号(灰)

```javascript
// 号源卡片双击事件
function handleCardDblClick(slot) {
    if (normalizeQueryStatus(slot.slotStatus) !== 'unbooked') {
        ElMessage.warning('该号源不可预约');
        return;
    }
    openPatientSelectDialog(slot);
}
```

### 门诊挂号签到页 -- 复杂表单交互

签到页是最复杂的前端页面，实现了完整的门诊挂号工作站：

- 患者信息录入（支持电子凭证/身份证/医保卡读卡）
- 科室 → 挂号类型 → 医生三级联动选择
- 预约签到一键流程（弹窗选择已预约患者 → 自动匹配挂号类型 → 预结算 → 收费 → 签到）
- hiprint 打印挂号单
- 键盘导航支持（方向键/Tab 在表单字段间切换）

### 前端状态归一化

前端和后端都做了状态归一化，形成双重保障：

```javascript
function normalizeQueryStatus(rawStatus) {
    const lower = rawStatus?.trim()?.toLowerCase();
    switch (lower) {
        case 'all':     case '全部':   return 'all';
        case '0':       case '未预约': return 'unbooked';
        case '1':       case '已预约': return 'booked';
        case '4':       case '已取号': return 'checked';
        case '2':       case '已停诊': return 'cancelled';
        case '5':       case '已退号': return 'returned';
        default: return '__invalid__';
    }
}
```

## 复杂 SQL 设计

### 状态归一化

由于系统演进过程中 `status` 字段可能存储为数字或英文字符串，Mapper 中定义了归一化表达式：

```xml
<sql id="slotStatusNormExpr">
    CASE
        WHEN LOWER(CONCAT('', s.status)) IN ('0', 'unbooked', 'available') THEN 0
        WHEN LOWER(CONCAT('', s.status)) IN ('1', 'booked') THEN 1
        WHEN LOWER(CONCAT('', s.status)) IN ('2', 'cancelled', 'canceled', 'stopped') THEN 2
        WHEN LOWER(CONCAT('', s.status)) IN ('3', 'locked') THEN 3
        WHEN LOWER(CONCAT('', s.status)) IN ('4', 'checked', 'checked_in', 'checkin') THEN 4
        WHEN LOWER(CONCAT('', s.status)) IN ('5', 'returned') THEN 5
        ELSE NULL
    END
</sql>
```

`CONCAT('', field)` 是 PostgreSQL 中将任意类型转为字符串的惯用技巧。

### 五表联查 -- 号源分页查询

```sql
SELECT
    s.id AS slotId, s.seq_no AS seqNo,
    p.doctor_name AS doctor, p.doctor_id AS doctorId,
    p.dept_id AS departmentId, org.name AS departmentName,
    p.fee AS fee,
    o.patient_id AS patientId, o.patient_name AS patientName,
    <include refid="orderStatusNormExpr" /> AS orderStatus,
    <include refid="slotStatusNormExpr" /> AS slotStatus,
    s.expect_time AS expectTime,
    p.schedule_date AS scheduleDate
FROM adm_schedule_slot s
    INNER JOIN adm_schedule_pool p ON s.pool_id = p.id
    LEFT JOIN adm_doctor_schedule d ON p.schedule_id = d.id
    LEFT JOIN adm_organization org ON p.dept_id = org.id
    LEFT JOIN (
        SELECT DISTINCT ON (slot_id) slot_id, patient_id, patient_name, status
        FROM order_main
        ORDER BY slot_id, create_time DESC
    ) o ON o.slot_id = s.id
```

使用 PostgreSQL 的 `DISTINCT ON (slot_id)` 语法，取每个槽位的最新订单，避免一个槽位有多条历史订单时产生笛卡尔积。

### 医生余号汇总查询

患者预约时需要看到每个医生当天的剩余号数，使用 `GREATEST` 防止余号出现负数：

```sql
SELECT
    p.doctor_id, p.doctor_name,
    COALESCE(SUM(GREATEST(p.total_quota - p.booked_num - p.locked_num, 0)), 0)
        AS available_total
FROM adm_schedule_pool p
WHERE p.schedule_date = #{date} AND p.delete_flag = '0'
GROUP BY p.doctor_id, p.doctor_name
```

### 状态查询的复杂分支

不同业务状态的查询条件差异很大，使用 `<choose><when>` 动态 SQL 实现。其中"已取号"状态有两种可能的数据来源（新流程用槽位状态 4，旧流程用订单状态 2），需要兼容处理：

```xml
<choose>
    <when test="'unbooked'.equals(query.status)">
        AND <include refid="slotStatusNormExpr" /> = 0
        AND (d.is_stopped IS NULL OR d.is_stopped = FALSE)
    </when>
    <when test="'booked'.equals(query.status)">
        AND <include refid="slotStatusNormExpr" /> = 1
        AND <include refid="orderStatusNormExpr" /> = 1
    </when>
    <when test="'checked'.equals(query.status)">
        AND (
            <include refid="slotStatusNormExpr" /> = 4
            OR (<include refid="slotStatusNormExpr" /> = 1
                AND <include refid="orderStatusNormExpr" /> = 2)
        )
    </when>
    <when test="'cancelled'.equals(query.status)">
        AND (<include refid="slotStatusNormExpr" /> = 2 OR d.is_stopped = TRUE)
    </when>
    <when test="'returned'.equals(query.status)">
        AND (<include refid="slotStatusNormExpr" /> = 5
             OR <include refid="orderStatusNormExpr" /> = 4)
    </when>
    <otherwise>
        AND 1 = 2
    </otherwise>
</choose>
```

## 技术总结

| 设计模式 | 应用场景 | 说明 |
|---------|---------|------|
| **CAS 原子抢占** | 预约挂号 | `UPDATE ... WHERE status = 0` 利用数据库行锁保证原子性 |
| **"绝对防御"数据强覆盖** | 预约挂号 | 不信任前端数据，关键字段全部以数据库查询结果为准 |
| **状态归一化** | SQL查询 | `CASE WHEN LOWER(CONCAT('', status))` 兼容数字/英文字符串 |
| **一次性令牌** | 前端签到 | `currentSlotId` 预结算成功后赋值、消费后立即清空 |
| **软关联 + 异常隔离** | 退号同步 | try-catch 隔离，主流程不依赖同步成功 |
| **聚合根统计** | 号源池 | 号源池管理 `booked_num`/`locked_num`，子查询实时重算 |
| **级联删除** | 排班删除 | 排班 → 号源池 → 号源槽 三层级联逻辑删除 |
| **DISTINCT ON** | 订单查询 | PostgreSQL 特有语法，取每个槽位的最新订单 |
| **数据库生成列** | 号源池 | `available_num` 由数据库自动计算，应用层不手动维护 |

## 踩过的坑与解决思路

### 1. 号源池统计漂移

**问题**：最初使用简单的 `booked_num + 1` 来更新号源池统计，在并发预约场景下出现计数漂移——两个请求同时读到 `booked_num = 5`，各自 +1 后写入 6，实际应该是 7。

**解决**：改用子查询实时重算 `COUNT(1)`，而不是基于旧值 +1/-1。虽然性能略低，但保证了数据准确性。对于医疗系统来说，正确性优先于性能。

### 2. 状态字段类型不一致

**问题**：系统演进过程中，`status` 字段在不同记录中混用了数字（0,1,2）和英文字符串（'booked','checked'），导致查询结果不完整。

**解决**：在 Mapper XML 中定义状态归一化 SQL 片段，使用 `CASE WHEN LOWER(CONCAT('', status))` 统一转换，同时前端也做了归一化，形成双重保障。

### 3. 前端签到串单

**问题**：签到流程涉及预结算 → 收费弹窗 → 支付回调三个异步步骤。如果用户快速连续操作两个患者，第二个患者的签到回调可能使用了第一个患者的 slotId。

**解决**：引入 `currentSlotId` ref 作为"一次性令牌"——预结算成功后才赋值，消费后立即清空。即使异步流程中用户切换了目标，旧的 slotId 已经被清空，不会串入新流程。

### 4. 退号跨系统同步失败

**问题**：门诊退号时需要同步更新预约系统状态，但如果同步逻辑抛异常，会导致整个退号流程失败。

**解决**：使用 try-catch 隔离同步逻辑，退号主流程不依赖预约同步成功。异常仅记录日志，后续可通过定时任务补偿。

## 项目收获

1. **DDD 分层架构实践**：从 Controller 到 Mapper，每一层职责清晰，业务逻辑集中在 AppService 层。实际开发中深刻体会到"编排层不写业务规则，领域层不碰数据库"的好处——测试和维护都容易很多。

2. **并发安全设计**：理解了 CAS 乐观锁在实际业务中的应用，以及为什么医疗系统需要"绝对防御"。在医院场景下，一个号源被重复预约、一笔费用被篡改，后果都比系统崩溃更严重。

3. **复杂 SQL 编写**：多表联查、动态条件、状态归一化、PostgreSQL 特有语法（DISTINCT ON、::date 类型转换、GENERATED ALWAYS 生成列）。从"能写 CRUD"到"能设计复杂查询"是一个质的提升。

4. **前后端联调**：状态管理、生命周期控制、异步流程中的防串单设计。前端不只是"调接口渲染页面"，还需要考虑异步竞态、状态一致性和用户体验。

5. **跨系统集成**：退号时的状态同步、软关联设计、异常隔离。在多系统协作中，"不阻塞主流程"比"保证同步成功"更重要。

6. **医疗行业理解**：号源管理的业务逻辑、患者隐私保护、数据准确性要求。医疗系统的特殊性在于：数据错误不会只是"显示 bug"，可能影响患者的就诊体验甚至医疗安全。
