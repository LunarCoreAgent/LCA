#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# LunarCore Agent · 本地数据桥（AkShare + BaoStock）
# 由应用自动管理生命周期：启动 / 停止 / 依赖安装。
# 仅监听 127.0.0.1:17895，不接受外部连接；依赖缺失时健康检查照常响应，数据接口返回 501。

import json
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

try:
    import akshare as ak
    HAS_AK = True
except Exception:
    HAS_AK = False

try:
    import baostock as bs
    HAS_BS = True
except Exception:
    HAS_BS = False

_spot_cache = {'t': 0.0, 'df': None}
_funda_cache = {}  # code -> {'t': 时间戳, 'd': 估值字典}（估值日内不变，缓存 6 小时）
_lock = threading.Lock()


def norm(code):
    """600519.SH -> (sh600519, sh.600519, 600519)"""
    num = code.split('.')[0]
    suf = code.split('.')[-1].upper()
    mkt = 'sh' if suf == 'SH' else ('bj' if suf == 'BJ' else 'sz')
    return mkt + num, mkt + '.' + num, num


def get_spot():
    """东财全市场快照，10 秒缓存（akshare 单次拉取较重）"""
    with _lock:
        if _spot_cache['df'] is None or time.time() - _spot_cache['t'] > 10:
            _spot_cache['df'] = ak.stock_zh_a_spot_em()
            _spot_cache['t'] = time.time()
        return _spot_cache['df']


def do_quote(code):
    _, _, num = norm(code)
    df = get_spot()
    row = df[df['代码'].str.endswith(num)]
    if row.empty:
        return None
    r = row.iloc[0]

    def f(k):
        try:
            return float(r.get(k, 0) or 0)
        except Exception:
            return 0.0

    return {
        'code': code, 'name': str(r.get('名称', num)),
        'price': f('最新价'), 'open': f('今开'), 'high': f('最高'), 'low': f('最低'),
        'preClose': f('昨收'), 'pctChg': f('涨跌幅'),
        'volumeWan': f('成交量') / 1e4, 'amountYi': f('成交额') / 1e8,
        'turnover': f('换手率'),
    }


def do_kline(code, n):
    _, bscode, _ = norm(code)
    lg = bs.login()
    if lg.error_code != '0':
        return None
    start = time.strftime('%Y-%m-%d', time.localtime(time.time() - max(n * 2.2, 60) * 86400))
    end = time.strftime('%Y-%m-%d')
    rs = bs.query_history_k_data_plus(
        bscode, 'date,open,high,low,close,volume,amount,turn,pctChg',
        start_date=start, end_date=end, frequency='d', adjustflag='2')
    rows = []
    while rs.error_code == '0' and rs.next():
        rows.append(rs.get_row_data())
    bs.logout()
    out = []
    for r in rows[-n:]:
        try:
            out.append({
                'date': r[0], 'open': float(r[1] or 0), 'high': float(r[2] or 0),
                'low': float(r[3] or 0), 'close': float(r[4] or 0),
                'volume': float(r[5] or 0), 'amount': float(r[6] or 0),
            })
        except Exception:
            pass
    return out


def do_fundamental(codes):
    """A股估值指标（乐咕乐股 lg_indicator，历史序列取最新一行）；单标的 6 小时缓存"""
    out = []
    for code in codes[:12]:
        _, _, num = norm(code)
        hit = _funda_cache.get(num)
        if hit and time.time() - hit['t'] < 6 * 3600:
            out.append(hit['d'])
            continue
        try:
            df = ak.stock_a_lg_indicator(symbol=num)
            if df is None or df.empty:
                continue
            r = df.iloc[-1]

            def f(k):
                try:
                    v = float(r.get(k, 0) or 0)
                    return v if v == v else 0.0  # NaN -> 0
                except Exception:
                    return 0.0

            d = {
                'code': code, 'date': str(r.get('trade_date', '')),
                'pe_ttm': f('pe_ttm'), 'pb': f('pb'), 'ps_ttm': f('ps_ttm'),
                'dv_ratio': f('dv_ratio'), 'total_mv_wan': f('total_mv'),
            }
            _funda_cache[num] = {'t': time.time(), 'd': d}
            out.append(d)
        except Exception:
            continue
        time.sleep(0.4)  # 防风控
    return out


# ==================== 数据库对接（结构设计 + 自动建库）====================
# SQLite 内置零依赖；PostgreSQL / MySQL 为可选依赖，缺失时返回 501 missing_dep。
# 结构版本追踪：lc_meta 表内 schema_version 键，当前版本见 DB_SCHEMA_VERSION。

import os
import sqlite3

try:
    import psycopg2
    HAS_PG = True
except Exception:
    HAS_PG = False

try:
    import pymysql
    HAS_MY = True
except Exception:
    HAS_MY = False

DB_SCHEMA_VERSION = 1

# 抽象列类型：pk=文本主键 / auto=自增主键 / str=可索引短文本 / text=长文本 / int / real / ts
# 表定义：(表名, 中文说明, 列, 索引列表)
DB_TABLES = [
    ('lc_meta', '结构版本与安装信息', [('key', 'pk'), ('value', 'text')], []),
    ('lc_conversations', '对话会话', [('id', 'pk'), ('title', 'str'), ('model', 'str'), ('created_at', 'ts'), ('updated_at', 'ts')], []),
    ('lc_messages', '对话消息（含知识库来源与路由轨迹）', [
        ('id', 'pk'), ('conversation_id', 'str'), ('role', 'str'), ('content', 'text'), ('model', 'str'),
        ('tokens', 'int'), ('kb_sources', 'text'), ('route_trace', 'text'), ('created_at', 'ts')],
     [['conversation_id'], ['created_at']]),
    ('lc_memories', '长期记忆', [('id', 'pk'), ('kind', 'str'), ('title', 'str'), ('content', 'text'),
     ('hits', 'int'), ('created_at', 'ts'), ('updated_at', 'ts')], [['kind']]),
    ('lc_kb_endpoints', '知识库端点（LLM Wiki / AnythingLLM，token_ref 存钥匙串键名不落明文）', [
        ('id', 'pk'), ('name', 'str'), ('type', 'str'), ('base_url', 'str'), ('target', 'str'),
        ('token_ref', 'str'), ('created_at', 'ts')], []),
    ('lc_kb_hits', '知识库检索记录', [('id', 'auto'), ('endpoint_id', 'str'), ('query', 'text'),
     ('hit_title', 'str'), ('score', 'real'), ('created_at', 'ts')], [['endpoint_id']]),
    ('lc_models', '模型配置（本地 / API / 聚合池）', [('id', 'pk'), ('kind', 'str'), ('name', 'str'),
     ('config', 'text'), ('status', 'str'), ('created_at', 'ts'), ('updated_at', 'ts')], [['kind']]),
    ('lc_watchlist', '自选监控', [('id', 'pk'), ('code', 'str'), ('name', 'str'), ('market', 'str'),
     ('note', 'text'), ('sort', 'int'), ('created_at', 'ts')], [['code']]),
    ('lc_activity_logs', '活动日志', [('id', 'auto'), ('kind', 'str'), ('text', 'text'), ('created_at', 'ts')],
     [['created_at'], ['kind']]),
    ('lc_evolution_runs', '自我进化记录', [('id', 'pk'), ('summary', 'text'), ('detail', 'text'), ('created_at', 'ts')], []),
    ('lc_channels', '手机渠道（飞书 / 微信 / LINE）', [('id', 'pk'), ('kind', 'str'), ('name', 'str'),
     ('config', 'text'), ('enabled', 'int'), ('created_at', 'ts'), ('updated_at', 'ts')], [['kind']]),
]

_TYPE_MAP = {
    'sqlite':   {'pk': 'TEXT PRIMARY KEY', 'auto': 'INTEGER PRIMARY KEY AUTOINCREMENT', 'str': 'TEXT', 'text': 'TEXT', 'int': 'INTEGER', 'real': 'REAL', 'ts': 'TEXT'},
    'postgres': {'pk': 'TEXT PRIMARY KEY', 'auto': 'BIGSERIAL PRIMARY KEY', 'str': 'TEXT', 'text': 'TEXT', 'int': 'BIGINT', 'real': 'DOUBLE PRECISION', 'ts': 'TIMESTAMPTZ'},
    'mysql':    {'pk': 'VARCHAR(64) PRIMARY KEY', 'auto': 'BIGINT PRIMARY KEY AUTO_INCREMENT', 'str': 'VARCHAR(255)', 'text': 'TEXT', 'int': 'BIGINT', 'real': 'DOUBLE', 'ts': 'TIMESTAMP NULL DEFAULT NULL'},
}


def build_ddl(engine):
    """返回 [(表名, 建表语句)], 索引语句单独由 build_indexes 给出（MySQL 不支持 IF NOT EXISTS 索引，需容错执行）"""
    out = []
    for name, comment, cols, _idx in DB_TABLES:
        col_sql = ',\n  '.join('%s %s' % (c, _TYPE_MAP[engine][t]) for c, t in cols)
        out.append((name, '-- %s\nCREATE TABLE IF NOT EXISTS %s (\n  %s\n);' % (comment, name, col_sql)))
    return out


def build_indexes(engine):
    out = []
    for name, _c, _cols, idxs in DB_TABLES:
        for cols in idxs:
            iname = 'idx_%s_%s' % (name[3:], '_'.join(cols))
            out.append('CREATE INDEX IF NOT EXISTS %s ON %s (%s);' % (iname, name, ', '.join(cols)))
    return out


class DbMissingDep(Exception):
    def __init__(self, pip):
        self.pip = pip


def db_connect(engine, cfg):
    if engine == 'sqlite':
        path = str(cfg.get('path') or 'lunarcore.db').strip() or 'lunarcore.db'
        if path != ':memory:':
            d = os.path.dirname(os.path.abspath(path))
            if d:
                os.makedirs(d, exist_ok=True)
        return sqlite3.connect(path)
    if engine == 'postgres':
        if not HAS_PG:
            raise DbMissingDep('psycopg2-binary')
        return psycopg2.connect(
            host=str(cfg.get('host') or '127.0.0.1'), port=int(cfg.get('port') or 5432),
            dbname=str(cfg.get('dbname') or 'lunarcore'), user=str(cfg.get('user') or 'postgres'),
            password=str(cfg.get('password') or ''), connect_timeout=8)
    if engine == 'mysql':
        if not HAS_MY:
            raise DbMissingDep('pymysql')
        return pymysql.connect(
            host=str(cfg.get('host') or '127.0.0.1'), port=int(cfg.get('port') or 3306),
            database=str(cfg.get('db') or 'lunarcore'), user=str(cfg.get('user') or 'root'),
            password=str(cfg.get('password') or ''), connect_timeout=8, charset='utf8mb4')
    raise ValueError('unknown_engine')


def _q(engine):
    """占位符风格"""
    return '%s'


def db_do_test(engine, cfg):
    conn = db_connect(engine, cfg)
    try:
        cur = conn.cursor()
        if engine == 'sqlite':
            cur.execute('SELECT sqlite_version()')
        elif engine == 'postgres':
            cur.execute('SHOW server_version')
        else:
            cur.execute('SELECT VERSION()')
        ver = str(cur.fetchone()[0])
        return {'ok': True, 'version': ver}
    finally:
        conn.close()


def db_do_install(engine, cfg):
    conn = db_connect(engine, cfg)
    created, skipped = [], []
    try:
        cur = conn.cursor()
        existing = set(_list_tables(engine, cur))
        for name, stmt in build_ddl(engine):
            cur.execute(stmt)
            (skipped if name in existing else created).append(name)
        for stmt in build_indexes(engine):
            try:
                if engine == 'mysql':
                    cur.execute(stmt.replace('IF NOT EXISTS ', ''))  # MySQL 无 IF NOT EXISTS 索引，重复建报 1061 忽略
                else:
                    cur.execute(stmt)
            except Exception:
                pass  # 索引已存在
        now = time.strftime('%Y-%m-%dT%H:%M:%S')
        if engine == 'sqlite':
            cur.execute("INSERT INTO lc_meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(DB_SCHEMA_VERSION),))
            cur.execute("INSERT INTO lc_meta(key, value) VALUES('installed_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (now,))
        elif engine == 'postgres':
            cur.execute("INSERT INTO lc_meta(key, value) VALUES('schema_version', %s) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", (str(DB_SCHEMA_VERSION),))
            cur.execute("INSERT INTO lc_meta(key, value) VALUES('installed_at', %s) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", (now,))
        else:
            cur.execute("INSERT INTO lc_meta(key, value) VALUES('schema_version', %s) ON DUPLICATE KEY UPDATE value=VALUES(value)", (str(DB_SCHEMA_VERSION),))
            cur.execute("INSERT INTO lc_meta(key, value) VALUES('installed_at', %s) ON DUPLICATE KEY UPDATE value=VALUES(value)", (now,))
        conn.commit()
        return {'ok': True, 'schema_version': DB_SCHEMA_VERSION, 'created': created, 'existing': skipped, 'tables': [t for t, _c, _col, _i in DB_TABLES]}
    finally:
        conn.close()


def _list_tables(engine, cur):
    if engine == 'sqlite':
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'lc_%'")
    elif engine == 'postgres':
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'lc\\_%'")
    else:
        cur.execute("SELECT table_name FROM information_schema.TABLES WHERE table_schema=DATABASE() AND table_name LIKE 'lc\\_%'")
    return [str(r[0]) for r in cur.fetchall()]


def _table_columns(engine, cur, table):
    if engine == 'sqlite':
        cur.execute("PRAGMA table_info(%s)" % table)
        return [str(r[1]) for r in cur.fetchall()]
    if engine == 'postgres':
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=%s ORDER BY ordinal_position", (table,))
    else:
        cur.execute("SELECT column_name FROM information_schema.COLUMNS WHERE table_schema=DATABASE() AND table_name=%s ORDER BY ordinal_position", (table,))
    return [str(r[0]) for r in cur.fetchall()]


def db_do_tables(engine, cfg):
    conn = db_connect(engine, cfg)
    try:
        cur = conn.cursor()
        out = []
        for t in sorted(_list_tables(engine, cur)):
            cols = _table_columns(engine, cur, t)
            rows = None
            try:
                cur.execute('SELECT COUNT(*) FROM %s' % t)
                rows = int(cur.fetchone()[0])
            except Exception:
                pass
            out.append({'name': t, 'columns': len(cols), 'rows': rows})
        ver = None
        try:
            cur.execute("SELECT value FROM lc_meta WHERE key='schema_version'")
            r = cur.fetchone()
            ver = int(r[0]) if r else None
        except Exception:
            pass
        return {'ok': True, 'schema_version': ver, 'tables': out}
    finally:
        conn.close()



class Handler(BaseHTTPRequestHandler):
    def _send(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == '/health':
            self._send({'ok': True, 'akshare': HAS_AK, 'baostock': HAS_BS,
                        'db': {'sqlite': True, 'postgres': HAS_PG, 'mysql': HAS_MY}, 'ts': int(time.time())})
        elif u.path == '/quote':
            if not HAS_AK:
                self._send({'error': 'missing_dep', 'pip': 'akshare'}, 501)
                return
            code = (q.get('code') or [''])[0]
            try:
                d = do_quote(code)
            except Exception as e:
                self._send({'error': 'quote_fail', 'detail': str(e)[:200]}, 502)
                return
            self._send(d if d else {'error': 'not_found'}, 200 if d else 404)
        elif u.path == '/kline':
            if not HAS_BS:
                self._send({'error': 'missing_dep', 'pip': 'baostock'}, 501)
                return
            code = (q.get('code') or [''])[0]
            n = int((q.get('n') or ['120'])[0])
            try:
                d = do_kline(code, n)
            except Exception as e:
                self._send({'error': 'kline_fail', 'detail': str(e)[:200]}, 502)
                return
            self._send({'items': d} if d is not None else {'error': 'bs_fail'}, 200 if d is not None else 404)
        elif u.path == '/fundamental':
            if not HAS_AK:
                self._send({'error': 'missing_dep', 'pip': 'akshare'}, 501)
                return
            codes = [c for c in (q.get('codes') or [''])[0].split(',') if c.strip()]
            try:
                d = do_fundamental(codes)
            except Exception as e:
                self._send({'error': 'funda_fail', 'detail': str(e)[:200]}, 502)
                return
            self._send({'items': d})
        elif u.path == '/db/engines':
            self._send({'engines': [
                {'id': 'sqlite', 'name': 'SQLite', 'available': True, 'note': '内置零依赖，数据存本机文件'},
                {'id': 'postgres', 'name': 'PostgreSQL', 'available': HAS_PG, 'pip': None if HAS_PG else 'psycopg2-binary'},
                {'id': 'mysql', 'name': 'MySQL', 'available': HAS_MY, 'pip': None if HAS_MY else 'pymysql'},
            ]})
        elif u.path == '/db/ddl':
            engine = (q.get('engine') or ['sqlite'])[0]
            if engine not in ('sqlite', 'postgres', 'mysql'):
                self._send({'error': 'unknown_engine'}, 400)
                return
            stmts = [s for _n, s in build_ddl(engine)] + build_indexes(engine)
            self._send({'engine': engine, 'schema_version': DB_SCHEMA_VERSION,
                        'tables': [n for n, _c, _col, _i in DB_TABLES], 'sql': '\n\n'.join(stmts)})
        else:
            self._send({'error': 'unknown_path'}, 404)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        if not u.path.startswith('/db/'):
            self._send({'error': 'unknown_path'}, 404)
            return
        try:
            n = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(n).decode('utf-8') or '{}') if n else {}
        except Exception:
            self._send({'error': 'bad_json'}, 400)
            return
        engine = str(body.get('engine') or 'sqlite')
        cfg = body.get('cfg') or {}
        try:
            if u.path == '/db/test':
                self._send(db_do_test(engine, cfg))
            elif u.path == '/db/install':
                self._send(db_do_install(engine, cfg))
            elif u.path == '/db/tables':
                self._send(db_do_tables(engine, cfg))
            else:
                self._send({'error': 'unknown_path'}, 404)
        except DbMissingDep as e:
            self._send({'error': 'missing_dep', 'pip': e.pip}, 501)
        except Exception as e:
            self._send({'error': 'db_fail', 'detail': str(e)[:300]}, 502)


if __name__ == '__main__':
    print('LunarCore 数据桥已启动: http://127.0.0.1:17895 (akshare=%s, baostock=%s, db[pg]=%s, db[mysql]=%s)' % (HAS_AK, HAS_BS, HAS_PG, HAS_MY), flush=True)
    HTTPServer(('127.0.0.1', 17895), Handler).serve_forever()
