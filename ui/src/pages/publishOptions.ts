/** 抖音自主声明选项 */
export const DY_DECLARATION_OPTIONS = [
  { value: "", label: "不添加自主声明" },
  { value: "内容由AI生成", label: "内容由AI生成" },
  { value: "内容为个人观点或见解", label: "内容为个人观点或见解" },
  { value: "内容为转载信息", label: "内容为转载信息" },
  { value: "内容含营销推广信息", label: "内容含营销推广信息" },
  { value: "虚构演绎，仅供娱乐", label: "虚构演绎，仅供娱乐" },
  { value: "无需添加自主声明", label: "无需添加自主声明" },
] as const;

/** 小红书内容类型声明 */
export const XHS_DECLARATION_OPTIONS = [
  { value: "", label: "不添加内容声明" },
  { value: "虚构演绎，仅供娱乐", label: "虚构演绎，仅供娱乐" },
  { value: "笔记含AI合成内容", label: "笔记含AI合成内容" },
  { value: "内容包含营销广告", label: "内容包含营销广告" },
  { value: "内容来源声明", label: "内容来源声明" },
] as const;
