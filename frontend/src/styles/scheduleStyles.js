export const PRINT_ROW_H = 84;

export const printCellBox = (rowSpan = 1, extra = {}) => ({
  height: PRINT_ROW_H * rowSpan,
  minHeight: PRINT_ROW_H * rowSpan,
  maxHeight: PRINT_ROW_H * rowSpan,
  overflow: "hidden",
  boxSizing: "border-box",
  verticalAlign: "top",
  display: "table-cell",
  ...extra,
});

export const PRINT_TIME_CELL = {
  width: 105,
  minWidth: 105,
  maxWidth: 105,
  height: PRINT_ROW_H,
  minHeight: PRINT_ROW_H,
  maxHeight: PRINT_ROW_H,
  padding: "0 8px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textAlign: "center",
  verticalAlign: "middle",
  fontSize: 10,
  fontWeight: 700,
  boxSizing: "border-box",
};

export const SUBJECT_ICONS = ["📐", "📊", "🔭", "🧬", "🖥️", "📡", "⚙️", "🧮", "📝", "🔬", "💡", "🗂️", "🌐", "🎯", "📈", "🔢", "🧩", "📚", "🛠️", "🔐", "💻", "🏗️", "🧪", "📋", "🗃️"];

export const PROFESSIONAL_HUES = [210, 173, 262, 15, 38, 340, 152, 282, 25, 199, 318, 48, 235, 95];

export const DEPT_SIGNATORIES = {
  "BSIT": {
    notedBy: { name: "MYLEN B. PADERES", title: "Dean SOICT" },
    approvedBy: { name: "HEIDI A. PAMA", title: "Academic Coordinator" },
  },
  "BSCS": {
    notedBy: { name: "Dr. JOHN DOE", title: "Dean of CICS" },
    approvedBy: { name: "MS. JANE SMITH", title: "Academic Coordinator" },
  },
  // ... more departments
};

export const tableStyles = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },
  header: {
    background: "#fff",
    padding: "14px 28px",
    fontSize: 18,
    fontWeight: 700,
    color: "#0f172a",
    display: "flex",
    alignItems: "center",
    borderBottom: "2px solid #e2e8f0",
  },
  cell: {
    padding: "10px 12px",
    border: "1px solid #ddd",
    textAlign: "center",
    verticalAlign: "middle",
  },
  headerCell: {
    padding: "14px 16px",
    fontWeight: 700,
    textAlign: "center",
    color: "#fff",
  },
};

export const modalStyles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  container: {
    background: "#fff",
    borderRadius: 16,
    padding: 28,
    width: "100%",
    maxWidth: 520,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    boxSizing: "border-box",
    boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
  },
};