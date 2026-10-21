// Positive-control canary for minify-detect (Overloop I4 / Sauron B1 / Rebreaker RB3).
// Lives under __minify_selftest__/ so the production walk skips it; the unit test points ROOT
// straight here. MUST trip >=2 default-on rules or the scanner is silently broken.
// String-assembled dynamic exec + decode-then-execute + computed dangerous member.
var _p=['\x61\x74\x6f\x62','\x65\x76\x61\x6c'];
var _a=function(x){return x.join('')};
window[_p[1]](window['at'+'ob']('cGF5bG9hZA=='));
new Function(_a(['ret','urn 1']))();
this['ev'+'al']('1');
