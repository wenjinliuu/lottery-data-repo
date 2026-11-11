// 测试用的内存数据库，只实现个人票据那几条查询用到的链式调用。
// user_tickets 模拟迁移里的行为：每次写入都换一个新的 sync_seq。
export function createFakeDb(seed = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  let seq = 0;
  const bump = (table, row) => { void table; void row; void seq; };
  const keysOf = (onConflict) => String(onConflict).split(",");

  function builder(table) {
    tables[table] ??= [];
    const state = { filters: [], orders: [], limit: null, action: "select", payload: null, options: {} };
    const matches = (row) => state.filters.every((filter) => filter(row));
    const api = {
      select() { return api; },
      eq(column, value) { state.filters.push((row) => row[column] === value); return api; },
      in(column, values) { state.filters.push((row) => values.includes(row[column])); return api; },
      gt(column, value) { state.filters.push((row) => row[column] > value); return api; },
      order(column, { ascending = true } = {}) { state.orders.push([column, ascending]); return api; },
      limit(count) { state.limit = count; return api; },
      upsert(payload, options = {}) { state.action = "upsert"; state.payload = payload; state.options = options; return api; },
      update(payload) { state.action = "update"; state.payload = payload; return api; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    function run() {
      const rows = tables[table];
      if (state.action === "upsert") {
        const keys = keysOf(state.options.onConflict);
        const written = [];
        for (const item of [].concat(state.payload)) {
          const existing = rows.find((row) => keys.every((key) => row[key] === item[key]));
          if (existing) {
            if (state.options.ignoreDuplicates) continue;
            Object.assign(existing, item);
            bump(table, existing);
            written.push(existing);
          } else {
            const row = { ...item };
            bump(table, row);
            rows.push(row);
            written.push(row);
          }
        }
        return { data: written.map((row) => ({ ...row })) };
      }
      if (state.action === "update") {
        const hit = rows.filter(matches);
        for (const row of hit) { Object.assign(row, state.payload); bump(table, row); }
        return { data: hit.map((row) => ({ ...row })) };
      }
      let result = rows.filter(matches);
      for (const [column, ascending] of [...state.orders].reverse()) {
        result = [...result].sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (ascending ? 1 : -1));
      }
      if (state.limit !== null) result = result.slice(0, state.limit);
      return { data: result.map((row) => ({ ...row })) };
    }
    return api;
  }
  return { from: builder, tables };
}
