import PCCImg  from "./pcc.png";
import BSBAImg from "./BA.png";
import CRIMImg from "./CRIM.png";
import HMImg   from "./hm.png";
import ITImg   from "./BSIT.png";
import EducImg from "./Educ.png";

const LOGO_MAP = {
  BSIT: ITImg,
  CRIM: CRIMImg,
  BSHM: HMImg,
  BSBA: BSBAImg,
  BEED: EducImg,
  BSED: EducImg,
};

export const PCCLogo   = PCCImg;
export const ITLogoSrc = ITImg;

export function getDeptLogo(code) {
  return LOGO_MAP[code] || null;
}

export function DeptLogo({ code, style, alt }) {
  const src = LOGO_MAP[code];
  if (!src) {
    return (
      <div style={{
        width:  style?.width  || 44,
        height: style?.height || 44,
        background: "rgba(255,255,255,0.12)",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 800,
        color: "#fff",
        flexShrink: 0,
      }}>
        {(code || "?").slice(0, 2)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt || code || ""}
      style={{ objectFit: "contain", flexShrink: 0, ...style }}
    />
  );
}