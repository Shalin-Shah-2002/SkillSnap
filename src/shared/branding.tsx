import React from "react";

export const BRAND_NAME = "SkillSnap";
export const BRAND_LOGO_URL = "logo-128.png";

export function BrandMark(props: { size?: number; className?: string }) {
  const size = props.size ?? 56;
  return (
    <img
      className={props.className ? `brand-mark ${props.className}` : "brand-mark"}
      src={BRAND_LOGO_URL}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      decoding="async"
      draggable={false}
    />
  );
}
