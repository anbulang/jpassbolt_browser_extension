/**
 * 姓名合并/拆分工具 —— 前端把邀请/编辑/资料表单收敛为单个「姓名」输入框,
 * 提交时智能拆成 Profile 表要求的 first_name / last_name 两列,显示时再拼回。
 *
 * 后端约束(不可改):Profile 表 first_name / last_name 均 NOT NULL 且 ≤255,
 * UserService.validateName 要求两字段都非空白;OpenAPI wire 仍发这两个字段。
 * 因此 splitFullName 必须保证返回的两个字段都非空(单字/单串走兜底复制),
 * joinName / initialsFromName 则负责把这份「复制」在显示时去重。
 */

/** 常见中文复姓(两字姓)——用于 CJK 姓名智能拆分。 */
const COMPOUND_SURNAMES = [
  '欧阳', '太史', '端木', '上官', '司马', '东方', '独孤', '南宫', '万俟', '闻人',
  '夏侯', '诸葛', '尉迟', '公羊', '赫连', '澹台', '皇甫', '宗政', '濮阳', '公冶',
  '太叔', '申屠', '公孙', '慕容', '仲孙', '钟离', '长孙', '宇文', '司徒', '鲜于',
  '司空', '闾丘', '子车', '亓官', '司寇', '巫马', '公西', '颛孙', '壤驷', '公良',
  '漆雕', '乐正', '宰父', '谷梁', '拓跋', '夹谷', '轩辕', '令狐', '段干', '百里',
  '呼延', '东郭', '南门', '羊舌', '微生', '公户', '公玉', '公仪', '梁丘', '公仲',
  '公上', '公门', '公山', '公坚', '左丘', '公伯', '西门', '东门', '西乡',
];

/** 是否含 CJK 表意文字(用于判定走中文「姓+名」还是西式「名 姓」)。 */
const isCJK = (s: string): boolean => /[㐀-鿿豈-﫿]/.test(s);

/**
 * 把单个「姓名」输入拆成后端要求的 first_name / last_name。
 * - 纯中文无空格:复姓表优先,否则首字为姓;单字名两字段都用该字兜底。
 * - 含空格(西式或用户自行空开):按第一个空格拆。
 * - 无空格非 CJK 单串:两字段都用该串兜底,保证后端两字段非空。
 */
export function splitFullName(full: string): { first_name: string; last_name: string } {
  const s = full.trim().replace(/\s+/g, ' ');
  if (!s) return { first_name: '', last_name: '' };
  if (isCJK(s)) {
    // 中文名统一按「首段为姓」的中式序拆,与 joinName 的 CJK 姓+名重排约定对齐,
    // 保证「李 明」这类含空格的中文名往返稳定(否则会被反转成「明李」)。
    const sp = s.indexOf(' ');
    if (sp > 0) return { last_name: s.slice(0, sp), first_name: s.slice(sp + 1) };
    // 无空格:复姓表优先,否则首字为姓
    const compound = COMPOUND_SURNAMES.find((c) => s.startsWith(c) && s.length > c.length);
    if (compound) return { last_name: compound, first_name: s.slice(compound.length) };
    if (s.length >= 2) return { last_name: s.slice(0, 1), first_name: s.slice(1) };
    return { last_name: s, first_name: s }; // 单字名兜底,两字段都非空满足后端
  }
  // 含空格(西式或用户自己空开):按第一个空格拆
  const idx = s.indexOf(' ');
  if (idx > 0) return { first_name: s.slice(0, idx), last_name: s.slice(idx + 1) };
  return { first_name: s, last_name: s }; // 无空格非 CJK 单串兜底
}

/**
 * 把 first_name / last_name 拼回展示用的「姓名」。
 * - 先按 f === l 去重:splitFullName 的单字/单串兜底会令两字段同值,
 *   若不先去重,CJK 分支的 l + f 会产出「张张」这类重复(已知坑)。
 * - CJK:姓在前、名在后,无空格(张 + 三 = 张三)。
 * - 西式:名 姓,空格连接(Ada Lovelace)。
 */
export function joinName(first?: string | null, last?: string | null): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (!f && !l) return '';
  if (f === l) return f; // 兜底复制去重,避免「张张」
  if (isCJK(f + l) && !f.includes(' ') && !l.includes(' ')) return l + f; // CJK:姓+名
  return [f, l].filter(Boolean).join(' ');
}

/**
 * 从一个已拼好的显示名取头像缩写:
 * - CJK:去空格后取前 1-2 字(姓+名首字,如「张三」→「张三」、「欧阳娜娜」→「欧阳」)。
 * - 西式:按空格/分隔符取前两段的首字母(Ada Lovelace → AL),否则取前两字符。
 * 永不返回空串(无有意义字符时返回 '?')。
 */
export function initialsFromName(name: string): string {
  const s = (name ?? '').trim();
  if (!s) return '?';
  if (isCJK(s)) {
    const compact = s.replace(/\s+/g, '');
    return compact.slice(0, 2) || '?';
  }
  const parts = s.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  return s.slice(0, 2).toUpperCase() || '?';
}

/**
 * 从 first/last(+可选 fallback 显示名,如用户名)取头像缩写。
 * 先 joinName 得到正确顺序的显示名再取缩写,天然避开「三张 / 张张」类问题。
 */
export function initialsFromNames(
  first?: string | null,
  last?: string | null,
  fallback?: string | null,
): string {
  const joined = joinName(first, last) || (fallback ?? '').trim();
  return initialsFromName(joined);
}
