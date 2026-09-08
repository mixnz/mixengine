import type { SharedDict } from "./en";

const vi: SharedDict = {
  common: {
    host: "Host",
    port: "Cổng",
    user: "Người dùng",
    password: "Mật khẩu",
    database: "Cơ sở dữ liệu",
    connect: "Kết nối",
    disconnect: "Ngắt kết nối",
    save: "Lưu",
    cancel: "Hủy",
    confirm: "Xác nhận",
    delete: "Xóa",
    duplicate: "Nhân bản",
    browse: "Duyệt...",
    close: "Đóng",
    scrollTabsLeft: "Cuộn tab sang trái",
    scrollTabsRight: "Cuộn tab sang phải",
    loading: "Đang tải...",
    readOnlyConnection: "Kết nối này được đánh dấu chỉ đọc. Đổi lại ở menu chuột phải của kết nối.",
    readOnly: "Chỉ đọc",
  },
  app: {
    settings: "Cài đặt",
    tabs: "Các tab đang mở",
    closeTab: "Đóng tab",
    newConnectionTab: "Tab kết nối mới",
    newConnectionTitle: "Kết nối mới",
    moduleDatabase: "Database",
    moduleRest: "REST",
    moduleTerminal: "Terminal",
    moduleTools: "Công cụ",
    moduleMixEngine: "MixEngine",
  },
  pagination: {
    previousPage: "Trang trước",
    nextPage: "Trang sau",
    status: "Trang {{page}}/{{pageCount}} \u00b7 {{total}} dòng",
    perPage: "{{n}} / trang",
  },
  select: {
    placeholder: "Chọn...",
    noOptions: "Không có tùy chọn",
    noMatches: "Không tìm thấy",
    searchPlaceholder: "Tìm...",
  },
  input: {
    clear: "Xoá",
  },
  errorBanner: {
    dismiss: "Đóng thông báo lỗi",
  },
  cellDialog: {
    title: "{{column}}, dòng {{n}}",
    copy: "Chép",
  },
  settings: {
    title: "Cài đặt",
    close: "Đóng",
    appearance: "Giao diện",
    theme: "Chế độ hiển thị",
    themeLight: "Sáng",
    themeDark: "Tối",
    themeSystem: "Hệ thống",
    accent: "Màu chủ đạo",
    accentBlue: "Xanh dương",
    accentIndigo: "Chàm",
    accentViolet: "Tím",
    accentMagenta: "Hồng sen",
    accentOrange: "Cam",
    accentAmber: "Hổ phách",
    accentGreen: "Xanh lá",
    accentTeal: "Xanh mòng két",
    accentCyan: "Xanh ngọc",
    accentSlate: "Xám đá",
    glass: "Liquid glass",
    glassOff: "Tắt",
    glassOn: "Bật",
    glassHint: "Làm mờ và bẻ cong phần nền sau các lớp nổi trên dữ liệu — menu, danh sách chọn, chú thích, thông báo cập nhật và ô đang tải. Hộp thoại thành một tấm kính mờ phủ lên cửa sổ thay vì một thẻ đục, hàng tiêu đề ghim của bảng làm mờ các dòng trượt bên dưới, còn nền trang và các điều khiển cũng lấy cùng chất liệu. Mặc định tắt; hiệu ứng này dùng tới card đồ hoạ, nên hãy tắt lại nếu thấy giật.",
    language: "Ngôn ngữ",
    languageEnglish: "English",
    languageVietnamese: "Tiếng Việt",
    privacyPolicy: "Chính sách quyền riêng tư",
    privacyHint:
      "MixDB không thu thập bất cứ thông tin nào về bạn và không có máy chủ nào của riêng nó. Những gì app ghi nhớ đều nằm lại trên máy này.",
    logHint: "Một file trên máy ghi lại các lỗi và crash, phòng khi cần xem kỹ hơn.",
    openLogFolder: "Mở thư mục log",
  },
  // Các tổ hợp Ctrl/Cmd ứng dụng nhận, đúng như Settings liệt kê. Phím riêng của một module được
  // đặt tên trong từ điển của module đó.
  shortcuts: {
    title: "Phím tắt",
    scope: {
      app: "Ứng dụng",
    },
    newTab: "Tab mới",
    newModuleTab: "Tab {{module}} mới",
    closeTab: "Đóng tab",
    nextTab: "Tab kế tiếp",
    prevTab: "Tab liền trước",
    reload: "Tải lại pane đang xem",
  },
  // Tìm, tải và cài bản MixDB mới. Việc tải chạy ngầm; việc cài thì đóng ứng dụng, nên nó chỉ xảy
  // ra khi người dùng tự bấm nút.
  update: {
    title: "Cập nhật",
    available: "Đã có MixDB {{version}}",
    runningNow: "Bạn đang dùng bản {{version}}",
    updateNow: "Cập nhật ngay",
    downloading: "Đang tải… {{percent}}%",
    downloadingUnknown: "Đang tải…",
    downloaded: "Bản MixDB {{version}} đã sẵn sàng để cài.",
    restartNow: "Cài và khởi động lại",
    installing: "Đang cài đặt…",
    restartHint: "MixDB sẽ đóng lại trong chốc lát rồi tự mở lên bản mới.",
    later: "Để sau",
    skip: "Bỏ qua bản này",
    skipped: "Đang bỏ qua bản {{version}}.",
    unskip: "Nhắc lại",
    checkNow: "Kiểm tra ngay",
    checking: "Đang kiểm tra...",
    upToDate: "Đây là bản mới nhất.",
    notCheckedYet: "Chưa kiểm tra lần nào.",
    checkFailed: "Kiểm tra thất bại: {{message}}",
    failed: "Cập nhật thất bại: {{message}}",
    lastChecked: "Kiểm tra lần cuối {{at}}.",
    openPage: "Mở trang tải về",
    moreChanges: "và {{count}} thay đổi khác",
    autoHint:
      "MixDB tự cập nhật. Mỗi bản cập nhật đều được đối chiếu với khóa ký của MixDB trước khi cài, nên không thứ gì không do dự án này ký có thể đến với bạn bằng đường này.",
  },
  // Thông báo khi một lệnh ở backend thất bại. Khóa ở đây chính là `code` mà `AppError` mang theo
  // — xem src-tauri/src/error.rs. `{{message}}` là nguyên văn lời của driver, không dịch: đó là
  // máy chủ đang nói, và cũng là phần đáng tra cứu nhất.
  error: {
    // MixEngine — daemon cục bộ mà app này quản lý. `message` là lời của chính daemon và không
    // bao giờ được dịch: đó là chuỗi người ta tra cứu được.
    mixengineNoHome: "Không xác định được MixEngine để file ở đâu.",
    mixengineNoSid: "Không đọc được định danh Windows của tài khoản này: {{message}}",
    mixengineUnreachable: "Không có daemon MixEngine nào trả lời ở {{endpoint}}.",
    mixenginePipeOwner:
      "Pipe của MixEngine ở {{endpoint}} đang do {{owner}} giữ, không phải tài khoản này.",
    mixengineRefused: "MixEngine từ chối: {{message}}",
    mixengineStartFailed: "Không khởi động được MixEngine: {{message}}",
    mixengineProtocol: "MixEngine trả lời một thứ phiên bản này không hiểu: {{message}}",
    // SSH
    sshTimeout:
      "Kết nối SSH tới {{host}}:{{port}} quá hạn sau {{seconds}} giây — kiểm tra host, cổng và tường lửa.",
    sshConnectFailed: "Không kết nối được tới máy chủ SSH: {{message}}",
    sshAuthFailed: "Xác thực SSH thất bại: {{message}}",
    sshShellFailed: "Không mở được shell trên máy chủ SSH: {{message}}",
    sshAuthRejected:
      "Máy chủ SSH từ chối đăng nhập (partial success: {{partialSuccess}}). Máy chủ chấp nhận: {{methods}}.",
    sshHostKeyChanged:
      "Máy chủ SSH tại {{endpoint}} đang đưa ra khóa khác với khóa MixDB từng thấy ({{fingerprint}} bây giờ, trước đó là {{known}}). Hoặc máy chủ vừa được dựng lại, hoặc có ai đó đang đứng giữa. Nếu thay đổi này là mong đợi, hãy xóa mục tương ứng trong {{file}} rồi kết nối lại.",
    cannotReadPrivateKey: "Không đọc được file khóa riêng: {{message}}",
    invalidPrivateKey: "Đây không phải khóa riêng mà MixDB đọc được: {{message}}",
    cannotBindTunnelPort: "Không mở được cổng cục bộ cho tunnel: {{message}}",
    tunnelAcceptFailed:
      "Cổng cục bộ của tunnel đã ngừng nhận kết nối: {{message}}. MixDB vẫn đang thử lại — nếu không trở lại, hãy đóng tab và kết nối lại.",
    cannotSaveKnownHost: "Không ghi nhớ được khóa của máy chủ: {{message}}",
    sshUnavailable: "Tunnel SSH hiện không mở — MixDB đang thử mở lại.",
    // Mật khẩu đã lưu
    credentialStoreUnreachable: "Không truy cập được kho mật khẩu của hệ điều hành: {{message}}",
    cannotSavePassword: "Không lưu được mật khẩu: {{message}}",
    cannotReadPassword: "Không đọc lại được mật khẩu đã lưu: {{message}}",
    cannotRemovePassword: "Không xóa được mật khẩu đã lưu: {{message}}",

    // Hai lỗi cả hai tầng cùng phát: một thư mục ứng dụng tự tạo, và một tác vụ giao cho luồng
    // nền. Module database cũng phát chúng, và đọc từ đây.
    cannotCreateDirectory: "Không tạo được {{path}}: {{message}}",
    backgroundTaskFailed: "Tác vụ không hoàn tất: {{message}}",
    // Lỗi duy nhất ở đây do webview báo chứ không phải backend. Phải nói rõ, vì nếu im lặng thì
    // người dùng dán ở chỗ khác và nhận đúng thứ đang có sẵn trong clipboard từ trước.
    clipboard: "Chưa sao chép được — clipboard từ chối: {{message}}",
    /** Dạng lỗi MixDB không nhận ra — hiển thị nguyên trạng thay vì nuốt mất. */
    unknown: "{{message}}",
    crashedTab: "Tab này gặp lỗi và không thể tiếp tục. Phần còn lại của MixDB không bị ảnh hưởng.",
    crashedApp: "MixDB gặp lỗi không thể tự phục hồi.",
    tryAgain: "Thử lại",
    restartApp: "Khởi động lại MixDB",
  },
};

export default vi;
