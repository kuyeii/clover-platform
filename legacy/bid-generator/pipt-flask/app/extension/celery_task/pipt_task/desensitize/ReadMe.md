# 一、整合/调用指南
- 在思诚原有的mask_desensitize.py基础上修改得到
  - Anonymizer 就是对 Desensitize 进行了一些扩充完善
  - 对all_desensitize()进行了修改。
  - 不知道mask_desensitize() 有什么用，删了
- 代码调用示例参考几个example.py
- 配置脱敏算法还是使用all_desensitize()，但是初始化Anonymizer时，需要额外传入一个dict，用于指定相应不同类型个人信息的脱敏方法
- 没有指定特定方法的个人信息类型默认使用mask进行处理


# 二、对之前脱敏功能扩充与调整说明：
## 二-1、支持的脱敏算法
- 遮盖（原有）
- 哈希（sha256）
- 对称加密（sm4）
- 较小假名库（相对快一些）的假名方法
  - TODO： 增加一些更大假名库的方法，降低假名冲突的可能
## 二-2、部分数据类型的算法限制
- 性别、民族、政治面貌：仅支持加密、哈希、遮盖

## 二-3、关于现有代码的备注（写给未来的自己）
- 各类方法在调用时都必须两个参数，{待脱敏数据、数据类型}
  - 尽管有些方法比如加密不需要知道数据类型，但是为了能够便利地进行**args操作，也加了

# 其他备忘
- 后续代码如果要直接写成可以调用的api接口，按照以下顺序修改完善几处代码：
  - 在 pipt-flask/app/extension/celery_task/pipt_task 中添加底层功能代码
  - 在 pipt-flask/app/extension/celery_task/tasks.py 中添加代码
  - 在 pipt-flask/app/api/piptool/job.py 中添加相应代码
- 相关的功能测试在主分支zeshouan里删除了。开发分支zeshouan-wei里还保留着
