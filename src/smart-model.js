/** Pure field editing and portable naming for the smart naming workspace. */
const field = (id, label, values, details = {}) =>
  Object.freeze({
    id,
    label,
    hint: "",
    optional: false,
    manual: false,
    ...details,
    options: Object.freeze(
      values.map((entry) => {
        const [value, meaning] = Array.isArray(entry) ? entry : [entry, entry];
        return Object.freeze({ value, label: meaning });
      }),
    ),
  });

const SMART_GENDER_CHOICES = [["MAL", "男性"], ["FMAL", "女性"], ["MPP", "男女都有"]];

export function normalizeSmartGender(value) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return SMART_GENDER_CHOICES.some(([option]) => option === code) ? code : "";
}

export const SMART_FIELDS = Object.freeze([
  field(
    "country",
    "语言 / 国家",
    [
      ["US", "英语"],
      ["TW", "台湾（繁体中文）"],
      ["JP", "日本"],
      ["ES", "西班牙"],
      ["PT", "葡萄牙"],
      ["DE", "德国"],
      ["FR", "法国"],
      ["IT", "意大利"],
      ["KR", "韩国"],
      ["MN", "闽南语"],
      ["TH", "泰国"],
      ["TR", "土耳其"],
      ["RU", "俄罗斯"],
    ],
    {
      hint: "按团队命名规范选择：US 表示英语，MN 表示闽南语；与画面语言识别字段区分，投放信息请手动核对。",
      manual: true,
    },
  ),
  field(
    "gender",
    "角色性别",
    SMART_GENDER_CHOICES,
    { hint: "视频只看后半段。仅男性选 MAL，仅女性选 FMAL，男女都有选 MPP。无法辨认时留空。" },
  ),
  field(
    "role",
    "角色类别",
    [
      ["MOV", "影视"],
      ["GAM", "游戏"],
      ["OCH", "原创角色"],
      ["CEL", "名人"],
      ["ANM", "动漫"],
      ["NKOL", "合作 KOL"],
      ["KOL", "非合作 KOL"],
      ["OTH", "其他"],
      ["CART", "美漫卡通 IP"],
      ["KIP", "韩漫 IP"],
    ],
    { hint: "注意 NKOL 为合作 KOL，KOL 为非合作 KOL；合作关系需人工确认。" },
  ),
  field("form", "素材形式", [
    ["DIA", "纯对话"],
    ["MM", "meme 网梗影视混剪"],
    ["DiaR", "对话 + 解压背景素材"],
    ["DiaG", "对话 + 小游戏背景"],
    ["DiaU", "对话 + 上下分屏"],
    ["RS", "实拍"],
    ["AGRS", "代理实拍"],
    ["SZR", "数字人（AI 虚拟 / 对口型）"],
    ["zhichu", "AIGC 直出"],
    ["hunjian", "混剪类素材"],
  ]),
  field("category", "内容类目", [
    ["Lcc", "对话 · 恋爱向 · 日常恋爱闲聊"],
    ["Lrp", "对话 · 恋爱向 · roleplay"],
    ["NonLrp", "对话 · 非恋爱 · roleplay"],
    ["NonLg", "对话 · 非恋爱 · 娱乐互动"],
    ["NonLcc", "对话 · 非恋爱 · 日常陪伴闲聊"],
    ["Tool", "对话 · 非恋爱 · 功能"],
    ["Fu", "meme · 搞笑幽默"],
    ["VsOth", "meme · 拉踩竞品"],
    ["VsR", "meme · 对比现实"],
    ["SPKB", "实拍 · 口播"],
    ["XNS", "虚拟人 · 口播"],
    ["PLT", "实拍 · 剧情"],
    ["JUQ", "KOL 二创 · 剧情"],
  ]),
  field("creator", "创意人", ["ZYY", "WZC", "LXF", "WW", "YG", "DXP"], {
    hint: "手动填写创意人缩写，与命名规则中的剪辑人缩写分开记录。",
    manual: true,
  }),
  field(
    "type",
    "素材类型",
    [
      ["vid", "视频"],
      ["pic", "图片"],
      ["gif", "动图"],
    ],
    { hint: "按本地文件类型自动填入；改标签不会转换文件格式。" },
  ),
  field(
    "product",
    "产品",
    [
      ["CP", "polybuzz"],
      ["CSH", "crushie"],
      ["ST", "soultalk"],
      ["CS", "旧代码，含义待确认"],
      ["CO", "旧代码，含义待确认"],
    ],
    {
      hint: "规范中的 crushie 使用 CSH；CS、CO 仅保留用于兼容旧标签，可在管理字段选项中调整。",
    },
  ),
  field(
    "marketing",
    "营销功能",
    [
      ["call_", "电话（旧代码，建议使用 call）"],
      ["chat", "聊天"],
      ["call", "电话"],
      ["Grch", "群聊"],
      ["Albu", "相册"],
      ["vore", "语音条"],
      ["im2vi", "图生视频"],
      ["dual", "双图互动"],
      ["inner", "内心独白"],
      ["other", "其他"],
      ["live", "直播"],
    ],
    {
      hint: "示例末尾的下划线用于分隔字段，无需手动追加。电话推荐使用 call，call_ 仅兼容旧标签。",
    },
  ),
  field(
    "quality",
    "精致度",
    [
      ["JZSC", "常规原创素材"],
      ["YZDD", "历史优秀素材迭代"],
      ["CHLA", "换语言"],
      ["KOLSC", "合作 KOL 素材二创"],
      ["Comp", "照扒竞品"],
      ["Copy", "复刻竞品"],
    ],
    {
      hint: "按素材实际制作方式核对；此字段表示制作来源和方式，不是清晰度等级。",
      manual: true,
    },
  ),
  field(
    "risk",
    "风险分类",
    [
      ["Noright", "正常 · 无版权风险"],
      ["Normal", "正常 · 有 IP、无擦边、无拉踩"],
      ["BlineY", "擦边 · 有版权风险"],
      ["BlineN", "擦边 · 无版权风险"],
      ["PutDownY", "拉踩 · 有版权风险"],
      ["PutDownN", "拉踩 · 无版权风险"],
      ["VSY", "对比 · 有版权风险"],
      ["VSN", "对比 · 无版权风险"],
    ],
    {
      hint: "按实际授权与素材内容人工确认；标签不代表版权或审核结论。",
      manual: true,
    },
  ),
  field("channel", "目标渠道", [["TY", "通用"], "GG", "FB", "TT", "DSP"], {
    hint: "按实际投放渠道手动选择，TY 表示通用。",
    manual: true,
  }),
  field(
    "femaleCategory",
    "女性向分类",
    [
      ["WINT", "自研（women-oriented In-house）"],
      ["WCOMP", "参考竞品（women-oriented Competitor）"],
    ],
    {
      hint: "有对应制作分类时填写。FMAL 素材会自动关闭此项。",
      optional: true,
      manual: true,
    },
  ),
  field("competitor", "竞品名", [], {
    hint: "使用竞品的英文名；无对应竞品时留空。",
    optional: true,
    manual: true,
  }),
  field("custom", "自定义文字", [], {
    hint: "有需要再填写，按模板追加到文件名；默认留空。",
    optional: true,
    manual: true,
  }),
  field(
    "language",
    "画面语言",
    [
      ["en", "英语"],
      ["zh", "中文"],
      ["ja", "日语"],
      ["es", "西班牙语"],
      ["pt", "葡萄牙语"],
      ["de", "德语"],
      ["fr", "法语"],
      ["it", "意大利语"],
      ["ko", "韩语"],
      ["mn", "蒙古语（语言代码，与命名标签 MN 区分）"],
      ["th", "泰语"],
      ["tr", "土耳其语"],
      ["mixed", "多种语言"],
    ],
    {
      hint: "仅记录画面文字语言，不识别音频；该字段默认不加入文件名。",
      optional: true,
    },
  ),
]);

const FIELD_IDS = new Set(SMART_FIELDS.map(({ id }) => id));
const PLACEHOLDERS = new Set([
  ...FIELD_IDS,
  "date",
  "shorthand",
  "sequence",
  "width",
  "height",
  "resolution",
  "ratio",
  "duration",
  "original",
  "extension",
  "separator",
]);
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const encoder = new TextEncoder();

function todayCode() {
  const now = new Date();
  return `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

export function normalizeSmartUniform(input) {
  const values = Object.fromEntries(SMART_FIELDS.map(({ id }) => [
    id,
    typeof input?.values?.[id] === "string" ? input.values[id].slice(0, 120) : "",
  ]));
  const enabled = Array.isArray(input?.enabled)
    ? SMART_FIELDS.filter(({ id }) => input.enabled.includes(id)).map(({ id }) => id)
    : [];
  return { values, enabled };
}

export const SMART_DEFAULTS = Object.freeze({
  date: todayCode(),
  start: 1,
  padding: 2,
  separator: "_",
  shorthand: "XQS",
  template:
    "{country}_{date}_{shorthand}_{sequence}_{gender}_{role}_{form}_{category}_{creator}_{ratio}_{type}_{product}_{marketing}_{quality}_{duration}_{risk}_{channel}_{femaleCategory}_{competitor}_{custom}",
});

function boundedInteger(value, fallback, min, max, label) {
  const candidate = value === undefined ? fallback : value;
  if (
    (typeof candidate !== "number" && typeof candidate !== "string") ||
    (typeof candidate === "string" && !/^\d+$/.test(candidate.trim()))
  )
    throw new Error(`${label}必须是 ${min}–${max} 范围内的整数。`);
  const number = Number(candidate);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error(`${label}必须是 ${min}–${max} 范围内的整数。`);
  return number;
}

function textValue(value, max = 120) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return Array.from(
    String(value)
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
      .trim(),
  )
    .slice(0, max)
    .join("");
}

export function normalizeSmartSettings(value = {}) {
  if (!isObject(value)) throw new Error("命名设置格式无效。");
  let date = value.date === undefined ? todayCode() : String(value.date).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date))
    date = date.slice(2).replaceAll("-", "");
  if (!/^\d{6}$/.test(date))
    throw new Error("日期请使用 YYMMDD 或 YYYY-MM-DD 格式。");
  const year = 2000 + Number(date.slice(0, 2));
  const month = Number(date.slice(2, 4));
  const day = Number(date.slice(4));
  const calendar = new Date(year, month - 1, day);
  if (
    calendar.getFullYear() !== year ||
    calendar.getMonth() !== month - 1 ||
    calendar.getDate() !== day
  )
    throw new Error("请填写有效的日期。");
  const separator =
    value.separator === undefined ? SMART_DEFAULTS.separator : value.separator;
  if (!["_", "-", " "].includes(separator))
    throw new Error("分隔符请选择下划线、短横线或空格。");
  const shorthand =
    value.shorthand === undefined
      ? SMART_DEFAULTS.shorthand
      : textValue(value.shorthand, 32);
  const template =
    value.template === undefined ? SMART_DEFAULTS.template : value.template;
  if (
    typeof template !== "string" ||
    !template.trim() ||
    template.length > 1500
  )
    throw new Error("命名模板不能为空，且最多 1500 个字符。");
  const matches = [...template.matchAll(/\{([^{}]*)\}/g)];
  for (const [, key] of matches) {
    if (!PLACEHOLDERS.has(key)) throw new Error(`未知命名字段：{${key}}。`);
  }
  if (/[{}]/.test(template.replace(/\{[^{}]*\}/g, "")))
    throw new Error("命名模板中的花括号不完整。");
  return {
    date,
    start: boundedInteger(
      value.start,
      SMART_DEFAULTS.start,
      0,
      999999,
      "起始序号",
    ),
    padding: boundedInteger(
      value.padding,
      SMART_DEFAULTS.padding,
      1,
      8,
      "序号位数",
    ),
    separator,
    shorthand,
    template: template.trim(),
  };
}

/** User dictionaries replace defaults per field; an explicit empty list stays empty. */
export function normalizeSmartOptions(input = {}) {
  const source = isObject(input) ? input : {};
  return Object.fromEntries(
    SMART_FIELDS.map(({ id, options }) => {
      if (id === "gender") return [id, options.map((option) => ({ ...option }))];
      const supplied =
        Object.hasOwn(source, id) && Array.isArray(source[id])
          ? source[id]
          : options;
      const seen = new Set();
      const clean = [];
      for (const entry of supplied.slice(0, 200)) {
        const value = textValue(isObject(entry) ? entry.value : entry, 64);
        if (!value || seen.has(value.toLowerCase())) continue;
        seen.add(value.toLowerCase());
        clean.push({
          value,
          label: textValue(isObject(entry) ? entry.label : value, 80) || value,
        });
        if (clean.length === 100) break;
      }
      return [id, clean];
    }),
  );
}

/** One-time upgrade of old bare-code dictionaries; normal edits still replace defaults. */
export function upgradeSmartOptions(input = {}, revision = 0) {
  const source = isObject(input) ? input : {};
  const result = normalizeSmartOptions(source);
  const addedCodes = {
    country: ["RU"],
    form: ["hunjian"],
    product: ["CSH"],
    channel: ["TT", "DSP"],
    creator: ["DXP"],
  };
  for (const { id, options } of SMART_FIELDS) {
    if (revision >= 2 && id !== "creator") continue;
    // Missing or invalid dictionaries already receive the current defaults.
    // A deliberately emptied field must remain empty.
    if (!Array.isArray(source[id]) || !result[id].length) continue;
    const definitions = new Map(
      options.map((option) => [option.value.toLowerCase(), option]),
    );
    result[id] = result[id].map((option) => {
      const definition = definitions.get(option.value.toLowerCase());
      return definition &&
        option.label.toLowerCase() === option.value.toLowerCase()
        ? { ...option, label: definition.label }
        : option;
    });
    const existing = new Set(
      result[id].map(({ value }) => value.toLowerCase()),
    );
    for (const code of addedCodes[id] || []) {
      if (result[id].length >= 100) break;
      if (existing.has(code.toLowerCase())) continue;
      result[id].push({ ...definitions.get(code.toLowerCase()) });
      existing.add(code.toLowerCase());
    }
  }
  return result;
}

const DEFAULT_NAMING_FIELDS = Object.freeze({
  role: "OTH",
  product: "CP",
  quality: "JZSC",
  risk: "Normal",
  channel: "TY",
});

export function defaultSmartFields(metadata = {}) {
  const source = isObject(metadata) ? metadata : {};
  const marker = String(
    source.type || source.kind || source.mediaType || source.mimeType || "",
  ).toLowerCase();
  const name = String(source.name || source.originalName || "");
  const type =
    marker === "gif" || marker === "image/gif" || /\.gif$/i.test(name)
      ? "gif"
      : ["image", "img", "pic"].includes(marker) ||
          marker.startsWith("image/") ||
          /\.(png|jpe?g|webp|avif|bmp|svg)$/i.test(name)
        ? "pic"
        : "vid";
  return {
    ...Object.fromEntries(SMART_FIELDS.map(({ id }) => [id, ""])),
    ...DEFAULT_NAMING_FIELDS,
    type,
  };
}

export function isSmartFemaleCategoryDisabled(asset) {
  return (
    asset.detectedGender === "FMAL" ||
    normalizeSmartGender(asset.fields?.gender) === "FMAL"
  );
}

/** Preserve manual edits and then enforce rules that apply to the whole asset. */
export function applySmartFields(
  asset,
  patch,
  { overwriteManual = false, source = "ai" } = {},
) {
  if (!isObject(asset) || !isObject(patch))
    throw new Error("素材字段格式无效。");
  const fields = { ...defaultSmartFields(asset.metadata) };
  for (const id of FIELD_IDS)
    fields[id] = id === "gender"
      ? normalizeSmartGender(asset.fields?.[id])
      : textValue(asset.fields?.[id] ?? fields[id]);
  const manual = new Set(
    Array.isArray(asset.manualFields)
      ? asset.manualFields.filter((id) => FIELD_IDS.has(id))
      : [],
  );
  for (const id of FIELD_IDS) {
    if (!Object.hasOwn(patch, id) || patch[id] === undefined) continue;
    if (source !== "manual" && manual.has(id) && !overwriteManual) continue;
    if (
      patch[id] !== null &&
      typeof patch[id] !== "string" &&
      typeof patch[id] !== "number"
    )
      continue;
    fields[id] = id === "gender"
      ? normalizeSmartGender(patch[id])
      : textValue(patch[id]);
    if (source === "manual") manual.add(id);
  }
  const updated = { ...asset, fields };
  if (source !== "preview" && isSmartFemaleCategoryDisabled(updated)) {
    fields.femaleCategory = "";
    manual.delete("femaleCategory");
  }
  return { ...updated, manualFields: [...manual] };
}

export function previewSmartUniformFields(asset, patch, all = false) {
  if (asset.hasAnalysis || asset.status === "ready" || (!all && !asset.selected))
    return asset;
  // Keep staged values available until analysis resolves the final gender.
  return applySmartFields(asset, patch, { source: "preview" });
}

export function applySmartAnalysis(asset, result) {
  const fields = { ...result };
  for (const [key, value] of Object.entries(DEFAULT_NAMING_FIELDS)) {
    if (!asset.fields?.[key] && !fields[key]) fields[key] = value;
  }
  if (!fields.category && !asset.fields?.category) fields.category = "Lcc";
  if (!fields.marketing && !asset.fields?.marketing) fields.marketing = "chat";
  return applySmartFields(
    { ...asset, detectedGender: normalizeSmartGender(fields.gender) },
    fields,
  );
}

export function smartRatio(width, height) {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "";
  for (const [x, y] of [
    [9, 16],
    [16, 9],
    [1, 1],
    [4, 3],
    [3, 4],
    [4, 5],
    [5, 4],
    [21, 9],
  ]) {
    if (Math.abs(w / h - x / y) / (x / y) <= 0.01) return `${x}-${y}`;
  }
  let a = w,
    b = h;
  while (b) [a, b] = [b, a % b];
  return `${w / a}-${h / a}`;
}

function filenameParts(asset) {
  const originalName = String(asset.sourceFile?.name || asset.file?.name || asset.originalName || "素材");
  const leaf = originalName.split(/[\\/]/).pop() || "素材";
  const match = leaf.match(/^(.*)\.([a-z\d]{1,12})$/i);
  return {
    originalName,
    original: match?.[1] || leaf,
    extension: asset.sourceFile
      ? asset.file.name.match(/\.([a-z\d]{1,12})$/i)?.[1] || ""
      : match?.[2] || "",
  };
}

function portableStem(value) {
  let safe = String(value)
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "_")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe))
    safe = `_${safe}`;
  return safe || "素材";
}

function truncateBytes(value, bytes) {
  let result = "",
    size = 0;
  for (const char of value) {
    const length = encoder.encode(char).length;
    if (size + length > bytes) break;
    result += char;
    size += length;
  }
  return result;
}

export function formatSmartNamingDuration(duration) {
  const seconds = Number(duration);
  return Number.isFinite(seconds) && seconds > 0 ? `${Math.trunc(seconds)}s` : "";
}

function namingContext(asset) {
  const metadata = isObject(asset.metadata) ? asset.metadata : {};
  const overrides = isObject(asset.namingMetadata) ? asset.namingMetadata : {};
  const width = Number(metadata.width),
    height = Number(metadata.height);
  const context = {
    width: Number.isFinite(width) && width > 0 ? String(Math.round(width)) : "",
    height:
      Number.isFinite(height) && height > 0 ? String(Math.round(height)) : "",
    resolution:
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
        ? `${Math.round(width)}x${Math.round(height)}`
        : "",
    ratio: smartRatio(width, height) || textValue(metadata.ratio),
    duration: formatSmartNamingDuration(metadata.duration),
  };
  for (const key of ["width", "height", "resolution", "ratio", "duration"]) {
    if (!Object.hasOwn(overrides, key)) continue;
    const raw = textValue(overrides[key], 64);
    context[key] =
      key === "duration" && /^\d+(?:\.\d+)?$/.test(raw) ? `${raw}s` : raw;
  }
  return context;
}

function renderTemplate(template, context, separator) {
  const chunks = [];
  for (const part of template.split(/(\{[^{}]+\})/g)) {
    if (part.startsWith("{") && part.endsWith("}")) {
      const key = part.slice(1, -1);
      if (key !== "separator") {
        if (context[key]) chunks.push({ value: true, text: context[key] });
        continue;
      }
    }
    const literal =
      part === "{separator}" ? separator : part.replaceAll("_", separator);
    for (const text of literal) {
      const previous = chunks.at(-1);
      if (
        text === separator &&
        !previous?.value &&
        previous?.text === separator
      )
        continue;
      chunks.push({ value: false, text });
    }
  }
  while (chunks.length && !chunks[0].value && chunks[0].text === separator)
    chunks.shift();
  while (
    chunks.length &&
    !chunks.at(-1).value &&
    chunks.at(-1).text === separator
  )
    chunks.pop();
  return chunks.map(({ text }) => text).join("");
}

function smartFieldValue(asset, id) {
  if (id === "femaleCategory" && isSmartFemaleCategoryDisabled(asset)) return "";
  return asset.fields?.[id];
}

/** Returns portable unique names in input order and always retains the source extension. */
export function buildSmartNames(assets, value = {}) {
  if (!Array.isArray(assets)) throw new Error("素材列表格式无效。");
  const settings = normalizeSmartSettings(value);
  if (assets.length + settings.start > 1000000)
    throw new Error("序号超出 999999，请降低起始序号。");
  const used = new Set();
  return assets.map((asset, index) => {
    if (!isObject(asset)) throw new Error("素材格式无效。");
    const parts = filenameParts(asset);
    const context = {
      ...Object.fromEntries(
        SMART_FIELDS.map(({ id }) => [id, textValue(smartFieldValue(asset, id))]),
      ),
      ...namingContext(asset),
      date: settings.date,
      shorthand: settings.shorthand,
      sequence: String(settings.start + index).padStart(settings.padding, "0"),
      original: parts.original,
      extension: parts.extension,
      separator: settings.separator,
    };
    // Empty fields collapse template separators; field codes such as call_ remain exact.
    let rendered =
      typeof asset.customStem === "string" && asset.customStem.trim()
        ? asset.customStem.trim()
        : renderTemplate(settings.template, context, settings.separator);
    const suffix = parts.extension ? `.${parts.extension}` : "";
    if (suffix && rendered.toLowerCase().endsWith(suffix.toLowerCase()))
      rendered = rendered.slice(0, -suffix.length);
    const stem = portableStem(rendered);
    let name = "",
      duplicate = 1;
    do {
      const collision =
        duplicate === 1
          ? ""
          : `${settings.separator}${String(duplicate).padStart(2, "0")}`;
      const shortened =
        truncateBytes(
          stem,
          220 - encoder.encode(suffix + collision).length,
        ).replace(/[. ]+$/g, "") || "素材";
      name = `${shortened}${collision}${suffix}`;
      duplicate++;
    } while (used.has(name.normalize("NFC").toLowerCase()));
    used.add(name.normalize("NFC").toLowerCase());
    return { id: asset.id, name, originalName: parts.originalName };
  });
}

function csvCell(value) {
  let string = String(value ?? "");
  // Excel may evaluate formulas after whitespace or control characters.
  if (
    /^[\s\u0000-\u001f\u007f]*[=+@-]/.test(string) ||
    /^[\t\r\n]/.test(string)
  )
    string = `'${string}`;
  return `"${string.replaceAll('"', '""')}"`;
}

export function smartCsv(assets, settings = {}, suppliedNames) {
  const fallbackNames = buildSmartNames(assets, settings);
  const mappedNames = new Map(
    Array.isArray(suppliedNames)
      ? suppliedNames.map((item) => [item.id, item])
      : [],
  );
  const names = assets.map(
    (asset, index) => mappedNames.get(asset.id) || fallbackNames[index],
  );
  const rows = [
    [
      "原文件名",
      "新文件名",
      ...SMART_FIELDS.map(({ label }) => label),
      "宽度",
      "高度",
      "时长（秒）",
      "比例",
    ],
  ];
  assets.forEach((asset, index) => {
    const metadata = asset.metadata || {};
    rows.push([
      names[index].originalName,
      names[index].name,
      ...SMART_FIELDS.map(({ id }) => smartFieldValue(asset, id) || ""),
      metadata.width || "",
      metadata.height || "",
      metadata.duration || "",
      smartRatio(metadata.width, metadata.height) || metadata.ratio || "",
    ]);
  });
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
