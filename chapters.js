// 教科書の目次（章・節・紙面ページ）
// 節の id は questions.js の section と対応させる（例："4-1" = 第4章1節）
const CHAPTERS = [
  { no: 0, title: "簿記とは", sections: [
    { id: "0-1", title: "簿記とは", page: 2 },
  ] },
  { no: 1, title: "財務諸表", sections: [
    { id: "1-1", title: "財務諸表の概要", page: 6 },
    { id: "1-2", title: "貸借対照表", page: 9 },
    { id: "1-3", title: "損益計算書", page: 39 },
  ] },
  { no: 2, title: "簿記の全体像", sections: [
    { id: "2-1", title: "全体像と帳簿", page: 50 },
    { id: "2-2", title: "期中手続き", page: 51 },
    { id: "2-3", title: "期末の手続き", page: 57 },
  ] },
  { no: 3, title: "基本的な取引と勘定科目", sections: [
    { id: "3-1", title: "基本的な取引", page: 68 },
    { id: "3-2", title: "当座預金と小切手", page: 78 },
  ] },
  { no: 4, title: "商品売買", sections: [
    { id: "4-1", title: "基本的な取引", page: 92 },
    { id: "4-2", title: "各債権債務", page: 112 },
    { id: "4-3", title: "貸倒れ", page: 126 },
    { id: "4-4", title: "記帳方法（三分法と分記法）", page: 129 },
  ] },
  { no: 5, title: "現金預金", sections: [
    { id: "5-1", title: "現金", page: 134 },
    { id: "5-2", title: "預金", page: 139 },
    { id: "5-3", title: "小口現金", page: 146 },
  ] },
  { no: 6, title: "固定資産に関連した取引", sections: [
    { id: "6-1", title: "賃貸借", page: 150 },
    { id: "6-2", title: "取得と売却", page: 154 },
    { id: "6-3", title: "修理", page: 162 },
  ] },
  { no: 7, title: "資金の貸借", sections: [
    { id: "7-1", title: "貸し付け・借り入れ", page: 166 },
  ] },
  { no: 8, title: "給料に関連した取引", sections: [
    { id: "8-1", title: "立替金・預り金", page: 174 },
    { id: "8-2", title: "給料の支払い（源泉徴収）", page: 177 },
  ] },
  { no: 9, title: "その他の取引", sections: [
    { id: "9-1", title: "租税公課・その他の費用", page: 184 },
    { id: "9-2", title: "仮払金・仮受金", page: 187 },
    { id: "9-3", title: "訂正仕訳", page: 191 },
  ] },
  { no: 10, title: "帳簿と伝票", sections: [
    { id: "10-1", title: "主要簿", page: 196 },
    { id: "10-2", title: "補助簿", page: 199 },
    { id: "10-3", title: "伝票", page: 217 },
  ] },
  { no: 11, title: "決算Ⅰ", sections: [
    { id: "11-1", title: "決算の概要", page: 232 },
    { id: "11-2", title: "帳簿の締め切り", page: 235 },
  ] },
  { no: 12, title: "決算Ⅱ", sections: [
    { id: "12-1", title: "決算整理総論", page: 250 },
    { id: "12-2", title: "減価償却", page: 252 },
    { id: "12-3", title: "貸倒引当金", page: 268 },
    { id: "12-4", title: "売上原価の算定", page: 283 },
    { id: "12-5", title: "経過勘定", page: 294 },
  ] },
  { no: 13, title: "決算Ⅲ", sections: [
    { id: "13-1", title: "現金過不足", page: 316 },
    { id: "13-2", title: "貯蔵品", page: 324 },
    { id: "13-3", title: "当座借越", page: 329 },
  ] },
  { no: 14, title: "決算Ⅳ", sections: [
    { id: "14-1", title: "精算表の作成", page: 334 },
    { id: "14-2", title: "月次決算", page: 342 },
  ] },
  { no: 15, title: "株式会社会計・税金", sections: [
    { id: "15-1", title: "株式会社", page: 348 },
    { id: "15-2", title: "税金", page: 355 },
  ] },
  { no: 16, title: "証ひょう", sections: [
    { id: "16-1", title: "証ひょうの問題", page: 364 },
  ] },
];
