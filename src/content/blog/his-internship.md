---
title: 'HIS 医院信息系统 -- 实习期间的排班、挂号与签到开发实践'
description: '实习期间独立负责医生排班、预约挂号、预约签到三个核心模块的前后端开发，涉及 CAS 并发控制、DDD 分层架构和复杂 SQL 设计。'
pubDate: '2026-04-28'
tags: ['项目复盘', 'Spring Boot', 'Vue', 'PostgreSQL', '实习']
---

> **项目类型**：医院信息管理系统（HIS, Hospital Information System）
> **技术栈**：Spring Boot + MyBatis-Plus + PostgreSQL | Vue 3 + Element Plus
> **架构风格**：DDD 分层架构（Controller → AppService → Domain Service → Mapper）
> **开发周期**：2026年3月 -- 2026年4月（实习期间）
> **个人职责**：独立负责医生排班、预约挂号、预约签到三个核心模块的前后端开发

## 项目背景

本项目是一套面向医院门诊场景的信息管理系统（OpenHIS），涵盖挂号收费、门诊医生站、预约管理、医保结算等模块。我实习期间主要负责**预约管理子系统**的三个核心功能模块：

| 模块 | 核心职责 | 用户角色 |
|------|---------|---------|
| 医生排班 | 管理医生出诊时间、诊室、限号数量、费用 | 科室管理员 |
| 预约挂号 | 号源展示、患者预约、取消预约 | 患者 / 挂号员 |
| 预约签到 | 患者到院签到、自动预结算、收费确认 | 收费员 |

三个模块构成一条完整的业务链路：**排班生成号源 → 患者预约消耗号源 → 到院签到完成就诊**。

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

## 项目收获

1. **DDD 分层架构实践**：从 Controller 到 Mapper，每一层职责清晰，业务逻辑集中在 AppService 层
2. **并发安全设计**：理解了 CAS 乐观锁在实际业务中的应用，以及为什么医疗系统需要"绝对防御"
3. **复杂 SQL 编写**：多表联查、动态条件、状态归一化、PostgreSQL 特有语法（DISTINCT ON、::date 类型转换）
4. **前后端联调**：状态管理、生命周期控制、异步流程中的防串单设计
5. **跨系统集成**：退号时的状态同步、软关联设计、异常隔离
6. **医疗行业理解**：号源管理的业务逻辑、患者隐私保护、数据准确性要求
