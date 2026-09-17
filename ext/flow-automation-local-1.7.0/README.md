# Flow Automation Local 1.7.0

Bản fork **local** dựa trên engine 1.5.6: automation prompt hàng loạt cho Google Flow,
nhưng **không** có backend tài khoản, **không** Firebase/GAS/OAuth và **không** đọc
`Authorization` header của phiên Google.

---

## 0. Có gì mới trong 1.7.0 — CHẠY NHIỀU TAB

Trước 1.7.0 tiện ích chỉ chạy được một tab. Mở tab thứ hai không phải là “cứ thế chạy”:
có **ba thứ dùng chung toàn trình duyệt** sẽ đánh nhau, và đây là những gì đã sửa.

### Lỗi nặng nhất: hai tab tải cùng lúc thì tên file bị ĐỔI CHÉO

`chrome.downloads` **không cho biết file vừa tải thuộc tab nào** (`DownloadItem` không có
`tabId`), mà hàng đợi tên file thì dùng chung. Đã tái hiện trên Chromium thật:

```
Tab 1 xếp tên "T1_canh_01", Tab 2 xếp tên "T2_canh_01", hai tab tải song song
   -> file của tab 1 nhận  T2_canh_01.txt
   -> file của tab 2 nhận  T1_canh_01.txt      (đổi chéo hoàn toàn)
```

Không có cách nào phân biệt chủ của một download, nên cách sửa đúng là **tuần tự hoá pha
tải**: tab nào tới lượt thì xin **khoá tải xuống** ở background, xong mới nhả cho tab kế
tiếp. Khoá có TTL 45s + gia hạn định kỳ, tự thu hồi nếu tab giữ khoá bị đóng hoặc treo,
nên không bao giờ làm cả hệ thống đứng. Phần **tạo video** (phần tốn thời gian, hàng phút)
vẫn chạy **song song** — chỉ pha tải (vài giây) là xếp hàng, nên gần như không mất tốc độ.
Xem `tests/multitab-chrome.js`: cùng phép thử đó, sau khi có khoá thì 2/2 file đúng tên.

### Các sửa chữa kèm theo (đều là lỗi thật khi chạy 2+ tab)

| Vấn đề | Trước 1.7.0 | Nay |
|---|---|---|
| **Cờ trạng thái chạy** | `activeRunningProject` / `autoResumeProject` là **biến đơn** cho cả trình duyệt. Bot có bước tự F5 trước khi tải, nên sau reload tab này khôi phục **dự án của tab kia**. | Bảng theo `tabId` (`veoRunState`), tự dọn khi tab đóng. Vẫn đọc được cờ cũ của bản ≤1.6.1 một lần để không mất dự án đang chạy khi cập nhật. |
| **Xoá hàng đợi tên file** | Tab thứ hai bắt đầu chạy gọi `CLEAR_FILENAME_QUEUE` **xoá sạch** hàng đợi, cuốn luôn tên đang chờ của tab thứ nhất. | Mỗi tên mang `tabId`; xoá/rút chỉ tác động tên **của chính tab đó**. |
| **Thông báo tải xuống** | `DOWNLOAD_STARTED` / `DOWNLOAD_COMPLETE` phát cho **mọi** tab Flow, tab nào cũng tưởng file là của mình (hai tab có thể sinh cùng một tên khi đặt tên theo số thứ tự). | Gửi đúng tab đang giữ khoá tải. |
| **Tab bị ẩn thì bot ngủ** | `mainLoop` có chốt “tab phải đang hiển thị”, nên tab thứ hai trong cùng cửa sổ ngủ ngay. | Bật đa tab thì bỏ chốt. Kèm **bộ dò throttle**: nếu lệnh chờ 1s thực tế mất &gt;5s (Chrome hãm tab ẩn), Log cảnh báo và gợi ý tách tab ra cửa sổ riêng. |
| **Tự tắt máy** | Tab nào xong trước là tắt máy, **giết luôn việc của các tab khác**. | Tab xong trước hỏi background `CAN_SHUTDOWN`, chờ tới khi **mọi** tab xong (kiểm tra 30s/lần, tối đa 6 giờ). |
| **Tạm dừng / dừng** | Nút Tạm dừng phát cho mọi tab. | Đa tab: chỉ tác động **tab đang xem**; có nút **Dừng tất cả** riêng. |
| **Đầy bộ nhớ** | Nội dung prompt bị lưu **hai lần** (trong `prompts[]` và trong từng `videos[].promptText`); dọn dẹp chỉ đếm “10 dự án mới nhất” mà không xét dự án **nặng** bao nhiêu. N tab thì vỡ quota nhanh gấp N lần. | Bỏ lưu trùng (dựng lại khi nạp dự án) và dọn theo **dung lượng thực** tới khi tổng ≤ 4.5MB; cảnh báo riêng nếu chính dự án đang chạy quá lớn (thường do dán nguyên JSON/kịch bản làm một prompt khổng lồ). |
| **Hạn mức của Flow** | — | Ô **Giãn nhịp (giây)**: cách các lần bấm “Tạo” của *mọi* tab ra, nên bật khi các tab dùng **chung một tài khoản Google** (hạn mức Flow tính theo tài khoản). Background đặt chỗ trước nên 3 tab hỏi cùng lúc nhận 3 mốc 0s / 15s / 30s. |

### Cách dùng

1. *Tab Chạy → **Chạy nhiều tab*** → bật **Bật chế độ nhiều tab**.
2. Mở thêm tab Flow. **Khuyến nghị mỗi tab một cửa sổ riêng** (nút **+ Cửa sổ**): Chrome
   không hãm nhịp tab ở cửa sổ khác, và mỗi cửa sổ có Side Panel riêng để theo dõi.
   Nhiều tab trong cùng một cửa sổ vẫn chạy được, chỉ chậm hơn khi bị ẩn.
3. Chọn **Cách chia việc**:
   - **Chia danh sách cho các tab** — dán một danh sách, tiện ích chia thành các dải liên
     tiếp (tab 1: prompt 1–10, tab 2: 11–20…). **Số thứ tự gốc được giữ nguyên**, nên tên
     file đánh theo số thứ tự không bị trùng giữa các tab. Nút Bắt đầu tự đổi thành
     “▶ Bắt đầu (chia N tab)”.
   - **Mỗi tab một dự án riêng** — mỗi cửa sổ tự nhập danh sách và chạy độc lập.
4. Danh sách **Tab Flow đang mở** hiện trạng thái từng tab (đang chạy / rảnh / chưa nạp
   script, tiến độ x/y, tab nào đang tải xuống, tab nào đang bị Chrome hãm 🐢). Bấm một
   tab để xem bảng tiến trình của **riêng tab đó**; Log gộp mọi tab và gắn tiền tố `[T1]`,
   `[T2]`.

### Lưu ý thật lòng về tốc độ

Nếu mọi tab dùng **cùng một tài khoản Google**, Flow thường xếp hàng theo tài khoản, nên
mở nhiều tab có thể **không** nhân được thông lượng mà chỉ tăng lỗi/đụng hạn mức — hãy bật
giãn nhịp. Nhiều tab nhân tốc độ thật khi mỗi cửa sổ dùng **profile Chrome / tài khoản khác
nhau**. Tiện ích hỗ trợ cả hai trường hợp.

---

## 1. Có gì mới trong 1.6.1

### Lỗi nghiêm trọng vừa phát hiện — tên file tiếng Việt

**Chrome ÂM THẦM TỪ CHỐI mọi tên file có ký tự ngoài ASCII.** Khi extension gọi
`suggest({filename})` với tên có dấu, Chrome bỏ qua không báo lỗi và file được lưu bằng
tên gốc của Google:

```
"01_Con_mèo_bay_trên_mây"  ->  Chrome bỏ  ->  download.mp4
"01_Con_meo_bay_tren_may"  ->  Chrome nhận
```

Đây chính là lý do trước đây **một số** file “không đổi được tên” trong khi số khác thì
được — phụ thuộc prompt có dấu hay không. Đã kiểm chứng trên Chromium thật với 14 trường
hợp (xem `tests/` kèm theo): trước khi sửa 8/14 bị bỏ, sau khi sửa 14/14 được áp dụng.

Cách sửa: tên file luôn được chuyển tự sang ASCII (bỏ dấu tiếng Việt, kể cả `đ/ơ/ư`;
bỏ dấu các ngôn ngữ Latin khác; emoji/CJK thành `_`), làm sạch theo **từng đoạn** đường
dẫn, tránh tên cấm của Windows (`CON`, `COM1`…), và cắt khoảng trắng/dấu chấm ở đầu–cuối
mỗi đoạn (Chrome cũng từ chối các trường hợp này). Tên hiển thị **trên Flow** vẫn giữ
dấu; nếu muốn hai bên khớp nhau, chọn *Cài đặt → Đổi tên file → “Bỏ dấu ở cả hai”*.

### Năm tính năng bạn yêu cầu

| | |
|---|---|
| **Đặt tên theo số thứ tự** | *Cài đặt → Đổi tên file → “Chỉ số thứ tự”*: chọn **số chữ số** (2 → `01`, 3 → `001`), **tiền tố** và **hậu tố**. Ví dụ `Canh_001`, `EP01_03_final`. Có **xem trước trực tiếp** hiện đúng đường dẫn cuối cùng. Nếu prompt tự mang số (`12. …`) thì số đó được ưu tiên để khớp với nhãn trên thẻ Flow. |
| **Kiểm tra setting “Hỏi vị trí lưu mỗi tệp”** | Nút **Kiểm tra** trong *Cài đặt → Tải xuống*. Chrome không có API đọc cài đặt này, nên tiện ích tải một tệp text 22 byte rồi đo phản ứng: bình thường hoàn tất trong ~50ms; khi hộp thoại đang mở thì đứng ở `in_progress` với tên rỗng. Kết luận **BẬT / TẮT / chưa rõ**, kèm **hướng dẫn 4 bước** và nút mở thẳng `chrome://settings/downloads`. |
| **Chọn thư mục lưu** | Ô *Thư mục lưu* trong *Cài đặt → Tải xuống*, hỗ trợ nhiều cấp và hai biến `{date}`, `{project}`. **Giới hạn của Chrome:** extension **không thể** chọn ổ đĩa hay đường dẫn tuyệt đối — chỉ tạo được thư mục con trong thư mục Tải xuống mặc định; muốn đổi ổ đĩa phải đổi *“Vị trí”* trong cài đặt Chrome. Đường dẫn kiểu `D:\Media\Flow` được tự hạ thành `Media/Flow`, và `..` không thoát ra ngoài được. |
| **Tải ngay sau khi tạo** | *Cài đặt → Tải xuống → Thời điểm tải*. Mặc định **Tự động**: chế độ Ảnh tải ngay sau mỗi prompt, chế độ Video vẫn gom lại tải ở cuối. Ở chế độ tải ngay, tiện ích **không** F5 giữa lúc chạy nữa (F5 giữa chừng làm mất thẻ vừa sinh). |
| **Ảnh → Video** | Tab riêng. Xem mục 3 bên dưới. |

### Sửa thêm trong 1.6.1

- **Thư mục con trước đây bất khả thi:** hàm làm sạch tên của 1.6.0 thay luôn `/` thành `_`.
  Nay làm sạch theo từng đoạn và giữ `/`.
- **`onInstalled` ghi đè cài đặt:** kiểu đọc-rồi-ghi `veoSettings` không nguyên tử — nếu
  Side Panel lưu cài đặt đúng vào khoảng giữa hai bước thì bản ghi đó bị xoá sạch. Bắt được
  đúng hiện tượng này khi test trên Chromium thật; nay chỉ ghi khi chưa có gì.
- **Phép thử “hỏi vị trí lưu” từng báo động sai:** bản đầu coi `USER_CANCELED` là “setting
  đang bật”, nhưng khi download bị chặn (chính sách máy, phần mềm bảo mật, trình duyệt bị
  điều khiển tự động) Chrome cũng trả `USER_CANCELED` — **sau 10ms**. Nay chỉ kết luận “bật”
  nếu việc hủy xảy ra sau ≥600ms, tức là có bàn tay con người; còn lại báo “chưa rõ”.
- **Gộp code trùng:** hai khối tải/tải-lại gần như y hệt trong `mainLoop` (≈120 dòng
  copy-paste) được gộp thành `tryDownloadStep()` để chế độ tải-ngay dùng lại.
- **Tên file rỗng / tên cấm:** prompt chỉ gồm dấu câu, hoặc trùng tên thiết bị của Windows,
  nay đều cho ra tên hợp lệ.

---

## 2. Tính năng của 1.6.0 (vẫn còn)

### Tính năng

| | |
|---|---|
| **Prompt không giới hạn ký tự** | Prompt dài bao nhiêu cũng được. Bảng tiến trình hiển thị **nguyên văn** (bấm vào để mở rộng) thay vì cắt còn 30 ký tự như bản cũ. |
| **Prompt nhiều dòng** | Chọn cách tách: mỗi dòng 1 prompt (mặc định) · dòng trống · `---` · `===`. Ba kiểu sau cho phép một prompt trải trên nhiều dòng. |
| **Nhập / Xuất `.txt`** | Nút **Nhập .txt** (chọn được nhiều file, hoặc **kéo–thả** file vào khung prompt) và nút **Xuất .txt** để lưu danh sách hiện tại. Khi nhập có sẵn prompt, bạn được chọn *thêm vào cuối* hay *thay thế*. |
| **Độ dài tên file tuỳ chỉnh** | Cài đặt → Đổi tên file → *Độ dài tên tối đa*. Đặt `0` = không giới hạn (vẫn chặn trần 150 ký tự vì Windows giới hạn đường dẫn ~260). |
| **UI mới** | Thanh trạng thái kết nối, nhóm cài đặt gập/mở, badge & pill trạng thái từng thẻ, thanh tiến độ tổng, bộ lọc theo trạng thái, log có bộ lọc + Copy/Lưu `.txt`, **theme sáng/tối**, nút **Dừng hẳn** riêng, xuất/nhập cài đặt JSON, responsive tới bề rộng 320px. |
| **Tiện ích prompt** | Đếm prompt + tổng ký tự + prompt dài nhất, xem trước danh sách đã tách, **Bỏ trùng**, **Xoá hết**, chọn nhanh *Tất cả / 10 đầu / 10 cuối*, phạm vi hỗ trợ dải (`1, 3, 7-12`). |

### Lỗi đã sửa (bản 1.5.6 có thật)

**Nhóm HOẠT ĐỘNG**

1. **Bot tự đứng im giữa lúc chạy.** `content-v2.js` gửi message `CHECK_TAB_ACTIVE`
   sang background, nhưng background **không có handler nào** cho action đó. Vì các
   listener khác `return true` (giữ kênh mở) mà không bao giờ gọi `sendResponse`,
   `await isTabActive()` treo vĩnh viễn và `mainLoop` dừng lại không báo lỗi.
   → Đã thêm handler ở background, đồng thời content script đọc
   `document.visibilityState` trước (không cần round-trip) và có timeout cứng 2s.
2. **Zoom bị nhân đôi.** Background đặt `chrome.tabs.setZoom(0.8)` *và* content
   script đặt `document.body.style.zoom = 0.8` → trang hiển thị ở **64%**, khiến
   `getBoundingClientRect()` lệch và các cú click bị hụt.
   → Chỉ dùng tab zoom; body zoom luôn được ép về mặc định.
3. **Thẻ đang tạo bị báo "xong" quá sớm.** `getCardStatus()` tính *số nút ⋮* thành
   số media (`completedCount = downloadBtns.length`), mà thẻ pending cũng có nút ⋮.
   → Chỉ tính media có `src` thật; thẻ lỗi/pending được xét **trước** thẻ hoàn tất.
4. **Đọc sai trạng thái trong overlay.** Bản cũ coi `offsetParent === null` là "bị ẩn",
   nhưng **mọi** phần tử `position: fixed` đều như vậy → chữ *"Hàng đợi"* /
   *"Không thành công"* trong overlay của Flow bị bỏ qua.
   → Thay bằng kiểm tra hiển thị theo computed style + kích thước thật.
5. **Mất thẻ sau khi F5.** Vòng tìm grid chỉ quét `.batch-tiles-section`, trong khi
   Flow 2025 dùng `<flow-grid-tile-container>` → không nối lại được thẻ, báo
   *"đang dò tìm"* mãi rồi timeout. → Quét cả hai, và chỉ lấy grid ngoài cùng.
6. **Prompt dài không khớp được thẻ.** Bản cũ so khớp 150 ký tự đầu (hoặc toàn bộ
   prompt) với chữ trên thẻ — nhưng Flow luôn rút gọn khi hiển thị nên gần như luôn
   trượt. → So khớp theo đoạn mồi 60 ký tự.
7. **Ô tìm kiếm bị nhồi cả prompt.** Prompt vài trăm/nghìn ký tự đưa vào ô search của
   Flow trả về 0 kết quả → *"Bộ lọc Search trống không"* → không tải được gì.
   → Chỉ dùng 80 ký tự đầu để lọc.
8. **`Reset` không xoá cờ auto-resume**, nên lần F5 sau bot lại tự chạy dự án cũ.
9. **Bộ nhớ không bao giờ được dọn.** Nhánh dọn dẹp chỉ chạy khi cờ "gói FREE" bật —
   cờ đó chưa từng được gán trong bản local → `chrome.storage.local` đầy dần rồi
   automation chết với lỗi quota. → Dọn theo dung lượng thực, giữ 10 dự án mới nhất.
10. **`RESUME_LOADED_PROJECT`** không đặt `activeRunningProject` và không báo
    `AUTOMATION_RESUMED` → nút vẫn hiện "Tiếp tục" dù bot đang chạy.
11. Xoá `checkWatchdog()`: code chết, chưa từng được đăng ký, và đọc hai thuộc tính
    (`hasError`, `totalVideos`) mà `getCardStatus()` không hề trả về — nếu chạy sẽ
    đánh sai trạng thái toàn bộ thẻ. Khai báo tường minh `downloadQueue` /
    `activeDownloads` (trước đây là biến global ngầm).

**Nhóm TẢI VỀ & ĐỔI TÊN FILE**

12. **Tên file bị lệch một nhịp.** Tên được đăng ký vào hàng đợi **trước** khi kiểm
    tra định dạng thẻ. Nếu thẻ bị bỏ qua (`continue`), cái tên đó nằm lại trong hàng
    đợi và bị gán cho **file kế tiếp** → toàn bộ file sau đó sai tên.
    → Kiểm tra định dạng trước, đăng ký tên sau; thêm `UNSET_NEXT_FILENAME` để rút
    tên ra khi bỏ qua hoặc khi hết thời gian chờ; xoá sạch hàng đợi khi bắt đầu chạy
    và khi Reset.
13. **Mất tên file khi service worker bị kill.** Hàng đợi tên chỉ nằm trong RAM của
    service worker; MV3 tắt worker sau ~30s rảnh → file tải về trở lại tên gốc của
    Google. → Lưu vào `chrome.storage.session`.
14. **Ghép sai phần mở rộng.** `item.filename.split('.').pop()` khi tên không có dấu
    chấm trả về **cả tên file** → sinh ra `ten.tenfilegoc`. → Tách đuôi đúng cách,
    có xử lý file ẩn (`.gitignore`) và đường dẫn Windows.
15. **Download treo khi đọc storage lỗi**: `suggest()` không được gọi → Chrome đứng ở
    trạng thái "đang xác định tên". → Luôn gọi `suggest()` đúng một lần, có timeout.
16. **Thẻ ẢNH không bị bỏ qua đúng.** Menu tải ảnh của Flow có mục *"Tăng lên 4K"*,
    mà bản cũ coi *"4k"* là bằng chứng của VIDEO → thẻ ảnh không bị skip, rồi không
    tìm thấy *"1080p"* nên văng lỗi và retry tới hết số lần thử.
    → Tính điểm video/ảnh, loại "4K" khỏi bằng chứng vì nó lưỡng nghĩa.
17. **Không có chất lượng mong muốn thì bỏ luôn.** Bản cũ chỉ hạ 1080p → 720p.
    → Hạ theo bậc đầy đủ cho cả video và ảnh.
18. **Tên file rỗng.** Prompt chỉ gồm dấu câu/emoji cho ra tên `05_` hoặc `05__1`.
    → Có tên dự phòng hợp lệ.
19. **Đổi tên trên Flow gần như luôn thất bại.** Hàm inject chỉ tìm ô nhập trong
    Radix portal (`[data-radix-popper-content-wrapper]`), còn Flow 2025 dùng Angular
    Material CDK overlay. → Quét cả `.cdk-overlay-pane`, `.mat-mdc-menu-panel`,
    `.mat-mdc-dialog-container`, `[role="dialog"]`, `[role="menu"]`; tìm nút ✓ trong
    cùng overlay, fallback Enter.
20. **Click vào menu đã đóng.** Mọi chỗ dùng `document.querySelectorAll('[role="menuitem"]')`
    toàn trang nên bắt cả mục của menu đã đóng còn sót trong DOM.
    → Thêm `getOpenMenuItems()` / `closeAnyOpenMenu()`, chỉ xét menu đang mở và đóng
    sạch overlay sau mỗi bước (menu còn mở sẽ che thẻ kế tiếp và làm kẹt vòng tải).

**Nhóm AUTO SHUTDOWN & KHÁC**

21. **Fallback tắt máy chưa từng chạy.** `shutdownSuccess` không được khai báo trong
    scope của `TRIGGER_SHUTDOWN`; khi Native Host chưa cài, `onDisconnect` đọc biến
    này và **ném `ReferenceError`** → file `.bat` dự phòng không bao giờ được tải.
    → Khai báo lại; `Test Native Host` có timeout 8s và thông báo lỗi tiếng Việt rõ ràng.
22. **`onInstalled` ghi đè cả object `veoSettings`** của người dùng. → Merge, không ghi đè.
23. **Message listener luôn `return true`** nên mọi `sendMessage` của caller không bao
    giờ resolve (rò rỉ kênh). → Chỉ giữ kênh mở cho handler async thật sự.
24. **`setPanelBehavior` chỉ gọi trong `onInstalled`** → mất thiết lập sau khi worker
    bị kill. → Gọi ở top-level.
25. **Side panel:** ô *"Đến dòng"* không thể đặt giá trị **1** (điều kiện
    `value === '1'` luôn ghi đè). → Chỉ tự điều chỉnh khi người dùng chưa tự sửa.
26. **Log phình DOM vô hạn** (bản cũ chỉ giới hạn mảng JS) gây tụt FPS sau vài giờ.
    → Giới hạn 600 dòng trong DOM.

---

## 3. Ảnh → Video (tạo video từ folder ảnh đã đánh số)

### Cách nó hoạt động

Tiện ích **không** tự phát minh cơ chế mới — nó tái sử dụng **Character Sync** vốn đã chạy
ổn định: sinh ra danh sách prompt trong đó mỗi dòng mang một thẻ `@<tên ảnh>`, và engine
có sẵn sẽ tự mở menu `[+]`, tìm ảnh theo tên trong kho Flow rồi đính kèm vào câu lệnh.

```
camera zoom vào rất chậm, giữ nguyên nhân vật @01     -> video 1 dùng ảnh 01
camera zoom vào rất chậm, giữ nguyên nhân vật @02     -> video 2 dùng ảnh 02
...
```

Ảnh **01 → video 1**, ảnh **02 → video 2**… đúng theo số thứ tự tên tệp.

### Ba bước

**Bước 1 — đưa ảnh vào kho Flow.** Cách ổn định nhất: mở project Flow, bấm **[+]** → tab
**Hình ảnh** → **Tải lên**, chọn **tất cả ảnh trong folder một lần** (Flow nhận nhiều tệp
cùng lúc). Tên tệp chính là mã tham chiếu nên **đừng đổi tên sau khi tải lên**.

Nếu muốn, tab này còn có nút **Chọn folder ảnh → Đẩy lên Flow** để tiện ích tự làm: nó đọc
ảnh trong Side Panel, gán trực tiếp vào ô tải lên của Flow theo lô 3 ảnh. Phần này **là thử
nghiệm** vì phụ thuộc giao diện upload của Google; nếu không chạy thì dùng cách thủ công ở
trên — kết quả hoàn toàn như nhau.

**Bước 2 — cấu hình.** Nhập **prompt chung** cho mọi ảnh, khoảng số ảnh (*từ … đến*), **số
chữ số** và tiền tố/hậu tố của tên ảnh. Có xem trước dòng prompt đầu tiên. Bật *“Ưu tiên
danh sách prompt ở tab Chạy”* nếu mỗi ảnh cần một prompt riêng (dòng N ↔ ảnh N; ảnh nào
thiếu dòng thì dùng prompt chung).

**Bước 3 — sinh danh sách.** Nút **Kiểm tra ảnh trong kho Flow** dò thử 12 mã đầu và cho
biết thiếu mã nào (rất hữu ích để phát hiện sai số chữ số hoặc sai tiền tố). Nút **Sinh
danh sách prompt** ghi danh sách vào tab **Chạy**, tự bật Character Sync, tự chuyển về chế
độ Video và đưa bạn sang tab đó. Kiểm tra lại rồi bấm **▶ Bắt đầu**.

### Lưu ý

- **Mã ảnh chỉ được gồm chữ, số và gạch dưới** — đó là giới hạn của regex `@tag`. Tên như
  `anh-01` hay `01.png` sẽ không khớp; tiện ích cảnh báo ngay khi xem trước.
- Mặc định tiện ích **xoá hẳn mã `@01` khỏi câu lệnh** gửi cho Flow (tuỳ chọn riêng), để mã
  tham chiếu không lọt vào nội dung prompt.
- Vì mọi video dùng cùng một prompt, hãy đặt **Đổi tên file → “Chỉ số thứ tự”**; nếu không,
  tên file của tất cả video sẽ gần như giống nhau.
- Nếu ảnh của bạn cần tạo **chuyển cảnh giữa hai ảnh liên tiếp** (ảnh N → ảnh N+1) thì dùng
  **Keyframe Sync** sẵn có với cú pháp `(@01, @02)` thay cho tab này.

---

## 4. Cài đặt

1. Giải nén thư mục extension.
2. Mở `chrome://extensions` → bật **Developer mode**.
3. **Load unpacked** → trỏ tới thư mục `flow-automation-local-1.6.1`.
4. Mở `https://flow.google.com/`, vào project cần chạy và **refresh trang một lần**.
5. Bấm icon extension để mở Side Panel.

> Nếu đang dùng bản trước, hãy bấm **Reload** ở thẻ extension rồi F5 tab Flow.
> Cài đặt cũ được giữ nguyên. Sau khi cài, nên làm hai việc:
> 1. *Cài đặt → Tải xuống → **Kiểm tra*** cài đặt “Hỏi vị trí lưu mỗi tệp”.
> 2. Nếu prompt của bạn có dấu tiếng Việt, xem lại phần **Đổi tên file** — tên file trên
>    máy giờ được bỏ dấu (bắt buộc, xem mục 1).

## 5. Cách dùng nhanh

0. *(Một lần)* Tab **Cài đặt → Tải xuống → Kiểm tra** để chắc Chrome không hỏi nơi lưu mỗi tệp.
1. Tab **Chạy** → dán prompt, hoặc bấm **Nhập .txt** / kéo–thả file `.txt`.
   Muốn tạo video từ folder ảnh đánh số thì dùng tab **Ảnh→Video** (mục 3).
2. Nếu prompt của bạn nhiều dòng, đổi **Cách tách prompt** cho phù hợp.
3. Chọn **Phạm vi chạy** (hoặc bật *Chỉ chạy các số chỉ định*, hỗ trợ `1, 3, 7-12`).
4. Tab **Cài đặt** → chế độ Video/Ảnh, số output, tỉ lệ, delay, đổi tên, tải xuống.
5. Quay lại tab **Chạy** → **▶ Bắt đầu**. Theo dõi ở bảng Tiến trình và tab Log.

- **⏸ Tạm dừng / ▶ Tiếp tục**: giữ nguyên tiến trình.
- **⏹**: dừng hẳn (tiến trình vẫn còn trong tab **Dự án**).
- **↺**: đặt lại tiến trình hiện tại, giữ danh sách prompt.

## 6. Auto Shutdown (không bắt buộc)

Không cần cài gì nếu bạn không dùng tính năng tự tắt máy. Nếu cần:

1. Vào `chrome://extensions`, copy **ID** của `Flow Automation Local`.
2. Máy cần Python + PyInstaller (`python -m pip install pyinstaller`).
3. Mở PowerShell tại thư mục `native-host`:

```powershell
powershell -ExecutionPolicy Bypass -File .\install_native_host.ps1 -ExtensionId YOUR_EXTENSION_ID -Browser Chrome
```

4. Restart Chrome → **Cài đặt → Auto Shutdown → Kiểm tra Native Host**.

Host chỉ chấp nhận 3 action: `ping`, `shutdown`, `cancel_shutdown` — không chạy lệnh
tuỳ ý. Nếu không cài Native Host, extension sẽ tải file `Flow_AutoShutdown.bat` để
bạn chạy thủ công.

## 7. Khác biệt bảo mật so với bản gốc thương mại

- **Không có `sniffer.js`.**
- **Không đọc `Authorization` header / token phiên của Google Flow.**
- **Không gọi Firebase, Google Apps Script, ipify hay backend thanh toán nào.**
- **Không yêu cầu quyền `identity`, không có Google OAuth.**
- Trạng thái hoàn thành đọc từ DOM của Flow, không dùng private workflow status RPC.
- Cloud Rename đi qua giao diện người dùng, không qua private API → có thể kém ổn
  định hơn nếu Google đổi UI, nhưng **tên file tải về vẫn luôn được Chrome ép đúng**.

## 8. Lưu ý vận hành

- Google Flow đổi DOM khá thường xuyên. Nếu không mở được menu tải, dùng
  **Cài đặt → Hiệu chỉnh selector → Chọn nút menu của thẻ** rồi click đúng nút ⋮ trên
  một thẻ Flow. Selector được lưu cục bộ.
- Nên để tab Flow ở trạng thái đang xem khi chạy: Flow chỉ render thẻ trong vùng nhìn
  thấy, chuyển tab lâu dễ làm bot mất dấu thẻ.
- Prompt dài không bị giới hạn, nhưng **tên file** vẫn bị chặn trần 150 ký tự vì giới
  hạn đường dẫn ~260 ký tự của Windows.
- Delay tối thiểu là 20s (video) / 10s (ảnh) để giảm rủi ro bị Google giới hạn tần suất.
