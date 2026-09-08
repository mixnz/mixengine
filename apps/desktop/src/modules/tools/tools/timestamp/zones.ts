/**
 * Danh sách múi giờ, dưới tên hiện hành của IANA.
 *
 * `Intl.supportedValuesOf("timeZone")` trả về tên **cũ** cho một số vùng — `Asia/Saigon` chứ không
 * phải `Asia/Ho_Chi_Minh`, `Asia/Calcutta` chứ không phải `Asia/Kolkata`, `Europe/Kiev` chứ không
 * phải `Europe/Kyiv`. Đó là các mục trong file `backward` của IANA, giữ lại để không phá vỡ dữ liệu
 * cũ, và ICU vẫn phát ra chúng. Không phải tên nào cũng chỉ là đổi chính tả: `Saigon` và `Kiev` là
 * tên của một thời khác, và đây là danh sách người dùng đọc.
 *
 * Chiều ngược lại thì không phải lo: runtime **nhận** tên hiện hành làm đầu vào dù nó không liệt kê
 * chúng, nên tên chuẩn đưa thẳng vào `Intl` là chạy. Nghĩa là ta hiển thị, lưu và tra cứu bằng
 * cùng một tên.
 */
export const LEGACY_ZONES: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

export function canonicalZone(zone: string): string {
  return LEGACY_ZONES[zone] ?? zone;
}

/* `Intl.supportedValuesOf` là ES2022 còn `lib` của dự án là ES2020, nên nó không có trong kiểu.
   Dò lấy ở đây thay vì nới `lib` cho cả repo vì đúng một lời gọi. */
const intlZones = (Intl as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;

/** Mọi múi giờ runtime biết, dưới tên hiện hành, không trùng lặp, đã sắp xếp. */
export function allZones(): string[] {
  const raw = intlZones ? intlZones("timeZone") : [Intl.DateTimeFormat().resolvedOptions().timeZone];
  return [...new Set(raw.map(canonicalZone))].sort();
}

/* `Intl.Locale.prototype.getTimeZones` cũng chưa có trong `lib` ES2020, dò như trên. Nó từng là
   getter `timeZones` trước khi đổi thành hàm, và webview cũ hơn có thể vẫn ở tên cũ. */
type LocaleWithZones = Intl.Locale & {
  getTimeZones?: () => string[] | undefined;
  timeZones?: string[];
};

function zonesOfLocale(locale: Intl.Locale): string[] {
  const withZones = locale as LocaleWithZones;
  return withZones.getTimeZones?.() ?? withZones.timeZones ?? [];
}

/**
 * Vùng nên chọn sẵn cho một máy, khi vùng hệ điều hành báo về có thể không đúng nước.
 *
 * Windows chỉ có những ID rất thô — `SE Asia Standard Time` phủ cả Bangkok, Hà Nội và Jakarta — và
 * ICU quy mỗi ID về một vùng đại diện. Với ID đó, đại diện là `Asia/Bangkok`. Một máy đặt tiếng
 * Việt vì thế mở lên đã sẵn Bangkok, và vì hai nơi cùng `+07:00` nên nhìn vào chênh lệch không ai
 * nhận ra.
 *
 * Nên: nếu nước trong locale có vùng riêng, vùng của máy không thuộc nước ấy, và **chênh lệch
 * trùng nhau**, thì lấy vùng của nước. Điều kiện chênh lệch là thứ giữ cho việc này không phá
 * trường hợp thật: một người Việt đang ngồi London có máy báo `Europe/London` và phải được yên.
 *
 * Chỉ đổi khi nước ấy có đúng một vùng trùng chênh lệch. Nhiều hơn thì không có cơ sở nào để chọn,
 * và đoán bừa còn tệ hơn cái mặc định đang có.
 */
export function preferredZone(machineZone: string, locales: readonly string[], at: number): string {
  const zone = canonicalZone(machineZone);
  const offset = zoneOffset(zone, at);

  for (const tag of locales) {
    if (!tag) continue;
    try {
      const locale = new Intl.Locale(tag);
      if (!locale.region) continue;

      const inRegion = zonesOfLocale(locale).map(canonicalZone);
      if (inRegion.length === 0) continue;
      // Vùng của máy vốn đã thuộc nước này — không có gì để sửa, và không hỏi tiếp nguồn nào nữa.
      if (inRegion.includes(zone)) return zone;

      const matching = inRegion.filter((name) => zoneOffset(name, at) === offset);
      if (matching.length === 1) return matching[0];
    } catch {
      // Thẻ ngôn ngữ hỏng thì bỏ qua và hỏi nguồn sau.
    }
  }

  return zone;
}

/**
 * Chênh lệch so với UTC tại một thời điểm, dạng `+07:00`.
 *
 * Theo thời điểm chứ không cố định: một nửa thế giới đổi giờ theo mùa, và một danh sách nói
 * `America/New_York` là `-05:00` giữa tháng bảy thì sai.
 *
 * Trả chuỗi rỗng cho vùng không có thật, thay vì ném: hàm này chạy cho từng dòng của một danh sách
 * bốn trăm mục, và một mục hỏng không nên làm sập cả cái danh sách.
 */
export function zoneOffset(zone: string, at: number): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(new Date(at))
      .find((part) => part.type === "timeZoneName")?.value;
    if (!name) return "";
    // `longOffset` cho ra `GMT+07:00`, và `GMT` trần cho các vùng đúng bằng UTC.
    const offset = name.replace("GMT", "");
    return offset === "" ? "+00:00" : offset;
  } catch {
    return "";
  }
}
