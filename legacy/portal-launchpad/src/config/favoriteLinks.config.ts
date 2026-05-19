export interface FavoriteLink {
  id: string;
  name: string;
  url: string;
  description: string;
  tag: string;
}

export const favoriteLinks: FavoriteLink[] = [
  {
    id: "industry-news",
    name: "产业新闻",
    url: "https://www.chacewang.com/chanye/news",
    description: "产业资讯入口，辅助查看行业动态与公开信息。",
    tag: "资讯",
  },
  {
    id: "ccgp",
    name: "中国政府采购网",
    url: "https://www.ccgp.gov.cn/index.shtml",
    description: "财政部官方政府采购信息发布平台，查询全国政府招标、中标、采购意向、政策法规、失信名单。",
    tag: "政采",
  },
  {
    id: "creditchina",
    name: "信用中国",
    url: "https://www.creditchina.gov.cn/",
    description: "投标必备信用查询，查企业失信、行政处罚、黑名单、信用报告。",
    tag: "信用",
  },
  {
    id: "court-execution",
    name: "中国执行信息公开网",
    url: "https://zxgk.court.gov.cn/",
    description: "查询企业、法人是否被列为失信被执行人、限制消费、法院执行信息，防止废标。",
    tag: "司法",
  },
  {
    id: "wenshu",
    name: "中国裁判文书网",
    url: "https://wenshu.court.gov.cn/",
    description: "查询企业涉诉判决、法律纠纷记录，用于投标资格审查。",
    tag: "司法",
  },
  {
    id: "gsxt",
    name: "国家企业信用信息公示系统",
    url: "https://shiming.gsxt.gov.cn/",
    description: "查企业工商信息、年报、异常经营、行政处罚。",
    tag: "工商",
  },
  {
    id: "energy-credit",
    name: "信用能源",
    url: "https://xyny.nea.gov.cn/publicity#/main",
    description: "能源行业信用信息平台，电力、油气企业投标信用查询。",
    tag: "能源",
  },
  {
    id: "gov-service",
    name: "全国一体化在线政务服务平台",
    url: "https://gjzwfw.www.gov.cn/index.html",
    description: "小微企业名录查询、各类政务服务、信用信息、资质证照统一查询入口。",
    tag: "政务",
  },
  {
    id: "scale-test",
    name: "中小企业规模类型自测小程序",
    url: "https://baosong.miit.gov.cn/scaleTest",
    description: "工信部官方工具，快速自测企业是否属中小微企业，用于享受政采扶持政策。",
    tag: "工信",
  },
  {
    id: "bank-code",
    name: "全国银行行号查询",
    url: "https://www.cwjyz.com.cn/bank/index.html",
    description: "查询银行联行号、SWIFT 代码，用于投标保证金、合同回款账户核验。",
    tag: "银行",
  },
  {
    id: "standard-platform",
    name: "全国标准信息公共服务平台",
    url: "https://std.samr.gov.cn/",
    description: "查询国家标准、行业标准、地方标准，用于投标技术参数符合性审查。",
    tag: "标准",
  },
  {
    id: "nmpa",
    name: "国家药品监督管理局",
    url: "https://www.nmpa.gov.cn/",
    description: "医药、医疗器械企业资质、产品注册证查询。",
    tag: "医药",
  },
  {
    id: "chinatax",
    name: "国家税务总局",
    url: "https://www.chinatax.gov.cn/",
    description: "查询税收政策、A 级纳税人、发票信息、税务违法记录，投标资信证明必备。",
    tag: "税务",
  },
  {
    id: "invoice-verify",
    name: "国家税务总局全国增值税发票查验平台",
    url: "https://inv-veri.chinatax.gov.cn/",
    description: "查验增值税发票真伪，防止虚假发票废标。",
    tag: "发票",
  },
  {
    id: "jzsc",
    name: "全国建筑市场监管公共服务平台（四库一平台）",
    url: "https://jzsc.mohurd.gov.cn/",
    description: "建筑企业资质、人员证书、工程项目业绩、诚信记录查询，工程投标必备。",
    tag: "建筑",
  },
  {
    id: "samr-service",
    name: "国家市场监督管理总局服务平台",
    url: "https://zwfw.samr.gov.cn/server",
    description: "企业登记、许可、认证、计量、特种设备等资质审批与查询。",
    tag: "市监",
  },
  {
    id: "samr-penalty",
    name: "中国市场监管行政处罚文书网",
    url: "https://cfws.samr.gov.cn/",
    description: "查询市场监管部门行政处罚文书，核查企业合规记录。",
    tag: "处罚",
  },
  {
    id: "cnca-cert",
    name: "全国认证认可信息公共服务平台",
    url: "http://cx.cnca.cn/CertECloud/index/index/page",
    description: "查询 3C、体系认证等证书真伪。",
    tag: "认证",
  },
  {
    id: "contract-template",
    name: "合同示范文本库",
    url: "https://htsfwb.samr.gov.cn/",
    description: "下载官方合同示范文本，用于投标文件、合同编制。",
    tag: "合同",
  },
  {
    id: "osta-cert",
    name: "国家职业资格证书全国联网查询",
    url: "https://zscx.osta.org.cn/",
    description: "核查人员职业资格证书真伪，用于投标人员配置审查。",
    tag: "人员",
  },
  {
    id: "chsi",
    name: "中国高等教育学生信息网（学信网）",
    url: "https://www.chsi.com.cn/",
    description: "查询学历学位真伪，用于投标项目负责人、技术人员资质审查。",
    tag: "学历",
  },
];
