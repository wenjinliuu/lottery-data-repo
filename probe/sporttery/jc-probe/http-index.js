const https = require('https');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36';
const B = 'https://webapi.sporttery.cn/gateway';
function get(url, referer) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.get(url, { headers: { 'User-Agent': UA, Referer: referer, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'zh-CN,zh;q=0.9' }, timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 400000) req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0, len: body.length, ctype: res.headers['content-type'], body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'timeout', ms: Date.now() - t0 }); });
    req.on('error', (e) => resolve({ status: 'error', err: String(e), ms: Date.now() - t0 }));
  });
}
async function probe() {
  const out = {};
  // 出口 IP
  const ip = await get('https://api.ipify.org?format=json', 'https://www.sporttery.cn/');
  out.egress = ip.body;
  const a = await get(`${B}/jc/football/getMatchCalculatorV1.qry?poolCode=hhad,had&channel=c`, 'https://www.sporttery.cn/');
  out.calc = { status: a.status, ms: a.ms, len: a.len, ctype: a.ctype, head: (a.body || '').slice(0, 300) };
  if (a.status !== 200) return out; // 遇到拦截即停止
  try { const j = JSON.parse(a.body); const m = j.value.matchInfoList.flatMap(d => d.subMatchList); out.calc.matches = m.length; out.calc.sample = m.slice(0, 2).map(x => ({ id: x.matchId, num: x.matchNumStr, league: x.leagueAbbName, home: x.homeTeamAbbName, away: x.awayTeamAbbName, time: x.matchDate + ' ' + x.matchTime, had: x.had && [x.had.h, x.had.d, x.had.a], hhad: x.hhad && [x.hhad.goalLine, x.hhad.h, x.hhad.d, x.hhad.a] })); } catch (e) { out.calc.parseErr = String(e); }
  const b = await get(`${B}/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=2018-09-01&matchEndDate=2018-09-07&leagueId=&pageSize=30&pageNo=1&isFix=0&matchPage=1&pcOrWap=1`, 'https://www.lottery.gov.cn/jc/zqsgkj/');
  out.result = { status: b.status, ms: b.ms, len: b.len, head: (b.body || '').slice(0, 200) };
  if (b.status !== 200) return out;
  let mid = null;
  try { const j = JSON.parse(b.body); const r = j.value.matchResult || []; out.result.count = r.length; out.result.total = j.value.total || j.value.totalCount; out.result.sample = r.slice(0, 2); mid = r[0] && r[0].matchId; } catch (e) { out.result.parseErr = String(e); }
  if (!mid) return out;
  const c = await get(`${B}/uniform/football/getOddsHistoryV1.qry?matchId=${mid}`, 'https://www.sporttery.cn/');
  out.history = { matchId: mid, status: c.status, ms: c.ms, len: c.len, head: (c.body || '').slice(0, 200) };
  try { const j = JSON.parse(c.body); const v = j.value || {}; out.history.keys = Object.keys(v); out.history.had = (v.hadList || []).slice(0, 3).concat((v.hadList || []).slice(-1)); out.history.hadCount = (v.hadList || []).length; out.history.hhad = (v.hhadList || []).slice(0, 2); out.history.hhadCount = (v.hhadList || []).length; } catch (e) { out.history.parseErr = String(e); }
  return out;
};

const http = require('http');
const port = Number(process.env.PORT || 9000);
http.createServer(async (req, res) => {
  let out;
  try { out = await probe(); } catch (e) { out = { fatal: String(e) }; }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out));
}).listen(port, '0.0.0.0', () => console.log('jc-probe listening on ' + port));
