export interface BidReferenceSite {
  id: string;
  name: string;
  url: string;
  description: string;
  tag: string;
}

const bidReferenceSites: BidReferenceSite[] = [
  {
    id: "industry-news",
    name: "产业新闻",
    url: "https://www.chacewang.com/chanye/news",
    description: "产业资讯",
    tag: "资讯",
  },
  {
    id: "ccgp",
    name: "中国政府采购网",
    url: "https://www.ccgp.gov.cn/index.shtml",
    description: "政府采购",
    tag: "政采",
  },
  {
    id: "creditchina",
    name: "信用中国",
    url: "https://www.creditchina.gov.cn/",
    description: "企业信用",
    tag: "信用",
  },
  {
    id: "court-execution",
    name: "中国执行信息公开网",
    url: "https://zxgk.court.gov.cn/",
    description: "执行信息",
    tag: "司法",
  },
  {
    id: "wenshu",
    name: "中国裁判文书网",
    url: "https://wenshu.court.gov.cn/",
    description: "裁判文书",
    tag: "司法",
  },
  {
    id: "gsxt",
    name: "国家企业信用信息公示系统",
    url: "https://shiming.gsxt.gov.cn/",
    description: "工商信息",
    tag: "工商",
  },
  {
    id: "energy-credit",
    name: "信用能源",
    url: "https://xyny.nea.gov.cn/publicity#/main",
    description: "能源信用",
    tag: "能源",
  },
  {
    id: "gov-service",
    name: "全国一体化在线政务服务平台",
    url: "https://gjzwfw.www.gov.cn/index.html",
    description: "政务服务",
    tag: "政务",
  },
  {
    id: "scale-test",
    name: "中小企业规模类型自测小程序",
    url: "https://baosong.miit.gov.cn/scaleTest",
    description: "规模自测",
    tag: "工信",
  },
  {
    id: "bank-code",
    name: "全国银行行号查询",
    url: "https://www.cwjyz.com.cn/bank/index.html",
    description: "银行行号",
    tag: "银行",
  },
  {
    id: "standard-platform",
    name: "全国标准信息公共服务平台",
    url: "https://std.samr.gov.cn/",
    description: "标准查询",
    tag: "标准",
  },
  {
    id: "nmpa",
    name: "国家药品监督管理局",
    url: "https://www.nmpa.gov.cn/",
    description: "药监资质",
    tag: "医药",
  },
  {
    id: "chinatax",
    name: "国家税务总局",
    url: "https://www.chinatax.gov.cn/",
    description: "税务信息",
    tag: "税务",
  },
  {
    id: "invoice-verify",
    name: "全国增值税发票查验平台",
    url: "https://inv-veri.chinatax.gov.cn/",
    description: "发票查验",
    tag: "发票",
  },
  {
    id: "jzsc",
    name: "全国建筑市场监管公共服务平台",
    url: "https://jzsc.mohurd.gov.cn/",
    description: "建筑资质",
    tag: "建筑",
  },
  {
    id: "samr-service",
    name: "国家市场监督管理总局服务平台",
    url: "https://zwfw.samr.gov.cn/server",
    description: "市监服务",
    tag: "市监",
  },
  {
    id: "samr-penalty",
    name: "中国市场监管行政处罚文书网",
    url: "https://cfws.samr.gov.cn/",
    description: "行政处罚",
    tag: "处罚",
  },
  {
    id: "cnca-cert",
    name: "全国认证认可信息公共服务平台",
    url: "http://cx.cnca.cn/CertECloud/index/index/page",
    description: "认证查询",
    tag: "认证",
  },
  {
    id: "contract-template",
    name: "合同示范文本库",
    url: "https://htsfwb.samr.gov.cn/",
    description: "合同文本",
    tag: "合同",
  },
  {
    id: "osta-cert",
    name: "国家职业资格证书全国联网查询",
    url: "https://zscx.osta.org.cn/",
    description: "资格证书",
    tag: "人员",
  },
  {
    id: "chsi",
    name: "中国高等教育学生信息网",
    url: "https://www.chsi.com.cn/",
    description: "学历查询",
    tag: "学历",
  },
];

// 获取招投标参考网站清单，当前为前端内置入口，返回值保持只读。
export function getBidReferenceSites(): readonly BidReferenceSite[] {
  return bidReferenceSites;
}
