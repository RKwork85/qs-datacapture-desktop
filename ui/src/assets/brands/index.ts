import dyIcon from "./dy.svg";
import xhsIcon from "./xhs.png";
import weiboIcon from "./weibo.svg";

export const brandIcons = {
  dy: dyIcon,
  xhs: xhsIcon,
  weibo: weiboIcon,
} as const;

export type BrandKey = keyof typeof brandIcons;
