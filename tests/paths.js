/* ============================================================================
   Đường dẫn dùng chung cho bộ test
   ----------------------------------------------------------------------------
   Trước đây mọi file test ghi cứng '/home/claude/...', nên clone repo về máy
   khác là chạy không được. File này quy chiếu mọi đường dẫn về GỐC REPO
   (thư mục cha của tests/), và cho phép ghi đè bằng biến môi trường.
   ========================================================================== */
const fs = require('fs');
const path = require('path');

/** Gốc repo = thư mục cha của tests/ */
const ROOT = path.resolve(__dirname, '..');

/** Bản tiện ích đang kiểm thử. Đổi bản: FLOW_VER=1.7.0 node tests/run.js */
const VERSION = process.env.FLOW_VER || '1.8.0';

/**
 * Thư mục tiện ích. Ưu tiên FLOW_EXT nếu người chạy trỏ tay vào một thư mục
 * khác (ví dụ bản đang sửa nằm ngoài repo).
 */
const EXT = process.env.FLOW_EXT
  ? path.resolve(process.env.FLOW_EXT)
  : path.join(ROOT, 'ext', `flow-automation-local-${VERSION}`);

/** Nơi lưu ảnh chụp giao diện. */
const SHOTS = process.env.FLOW_SHOTS ? path.resolve(process.env.FLOW_SHOTS) : path.join(ROOT, 'shots');

/**
 * Chromium để Playwright dùng.
 *   - Trong môi trường phát triển (sandbox) đã có sẵn ở /opt/pw-browsers/chromium.
 *   - Trên máy thường: trả về undefined để Playwright tự dùng bản nó tải về
 *     (`npx playwright install chromium`).
 * Có thể ghi đè bằng CHROMIUM_PATH.
 */
function chromiumPath() {
  const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;   // Playwright tự tìm bản mặc định
}

/** Tham số launch dùng chung: chỉ chèn executablePath khi thực sự có file. */
function launchOpts(extra = {}) {
  const exe = chromiumPath();
  return exe ? { executablePath: exe, ...extra } : { ...extra };
}

if (!fs.existsSync(EXT)) {
  console.error(`\n✗ Không tìm thấy thư mục tiện ích:\n    ${EXT}\n` +
    `  Kiểm tra lại FLOW_VER / FLOW_EXT, hoặc chạy lệnh từ trong repo.\n`);
  process.exit(1);
}

module.exports = { ROOT, VERSION, EXT, SHOTS, chromiumPath, launchOpts };
