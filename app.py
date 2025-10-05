from flask import Flask, render_template, request, jsonify, send_from_directory
import sqlite3
import os
import pyperclip
import threading
import time
from flask_socketio import SocketIO
import re
from datetime import datetime
import shutil
# 获取本机IP地址
import socket
import pyperclip
import json
import requests
import webbrowser
from werkzeug.utils import secure_filename
import tempfile
import ffmpeg
from werkzeug.exceptions import RequestEntityTooLarge

app = Flask(__name__)
socketio = SocketIO(app, async_mode='threading', cors_allowed_origins="*")

# —— 上传配置 ——
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'uploads', 'videos')
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB 上限（按需调整）
ALLOWED_VIDEO_EXTS = {'mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'}

# 视频压缩配置
VIDEO_COMPRESS_THRESHOLD = 500 * 1024 * 1024  # 500MB 超过此大小自动压缩
VIDEO_COMPRESS_TARGET_SIZE = 450 * 1024 * 1024  # 压缩目标大小 450MB以内

def allowed_video(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_VIDEO_EXTS

def compress_video(input_path, output_path, target_size_mb=450):
    """压缩视频到目标大小"""
    try:
        # 获取原始视频信息
        probe = ffmpeg.probe(input_path)
        duration = float(probe['format']['duration'])

        # 计算目标比特率 (考虑到一些额外开销，使用90%的目标大小)
        target_size_bytes = target_size_mb * 1024 * 1024 * 0.9
        target_total_bitrate = int((target_size_bytes * 8) / duration)

        # 分配视频和音频比特率
        if target_total_bitrate > 256000:  # 如果总比特率足够高
            audio_bitrate = 128000  # 128k音频比特率
            video_bitrate = target_total_bitrate - audio_bitrate
        else:
            # 如果总比特率太低，调整音频比特率
            audio_bitrate = min(64000, target_total_bitrate // 4)
            video_bitrate = target_total_bitrate - audio_bitrate

        # 确保视频比特率不会过低
        video_bitrate = max(500000, video_bitrate)  # 最低500k

        print(f"视频压缩参数: 总时长={duration:.2f}s, 目标大小={target_size_mb}MB, 视频比特率={video_bitrate}, 音频比特率={audio_bitrate}")

        # 执行压缩
        (
            ffmpeg
            .input(input_path)
            .output(
                output_path,
                vcodec='libx264',
                video_bitrate=video_bitrate,
                audio_bitrate=audio_bitrate,
                bufsize='64k',
                format='mp4'
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
        return True
    except Exception as e:
        print(f"视频压缩失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

# 全局变量
jianshang_api_url = "https://act-hk4e-api.miyoushe.com/event/musicugc/v1/second_page"
jianshang_api_initialized = False  # API初始化状态标志

# API配置
JIANSHANG_API_PARAMS = {
    "key": "Button_Jianshang",
    "is_from_button": "true", 
    "page": 1,
    "page_size": 30,
    "lang": "zh-cn",
    "game_biz": "hk4e_cn",
    "is_mobile": "false",
}

# Cookie配置（可根据需要修改）
JIANSHANG_API_COOKIE = (
    "mi18nLang=zh-cn; "
    "_MHYUUID=2903d6c6-de16-4f7b-b56f-6b78a2c4bc43; "
    "DEVICEFP_SEED_ID=4f0ea30a34259807; "
    "DEVICEFP_SEED_TIME=1756749599682; "
    "DEVICEFP=38d810118c4f3; "
    "SERVERID=f815eaf6a4679837f990ebc085032436|1756749605|1756749590"
)

JIANSHANG_API_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://act.miyoushe.com",
    "Referer": "https://act.miyoushe.com/ys/event/ugc-music-stable/index.html?mhy_presentation_style=fullscreen&mhy_auth_required=true&game_biz=hk4e_cn",
    "Cookie": JIANSHANG_API_COOKIE,
}

def backup_database():
    """备份数据库文件"""
    if not os.path.exists('scores.db'):
        return
        
    # 创建backups目录（如果不存在）
    if not os.path.exists('backups'):
        os.makedirs('backups')
    
    # 生成备份文件名（使用当前时间戳）
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_filename = f'backups/scores_{timestamp}.db'
    
    try:
        # 复制数据库文件
        shutil.copy2('scores.db', backup_filename)
        print(f'数据库已备份到: {os.path.abspath(backup_filename)}')
    except Exception as e:
        print(f'备份数据库时出错: {e}')

# 数据库初始化
def init_db():
    conn = sqlite3.connect('scores.db')
    c = conn.cursor()
    
    # 创建曲谱表（如果不存在）
    c.execute('''
        CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            score_code TEXT NOT NULL,
            completion INTEGER NOT NULL,
            difficulty INTEGER NOT NULL DEFAULT 0,
            region TEXT NOT NULL DEFAULT 'CN',
            is_favorite BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # 检查并添加缺失的列
    try:
        # 检查 completion 列是否存在
        c.execute('SELECT completion FROM scores LIMIT 1')
    except sqlite3.OperationalError:
        # 如果不存在，添加 completion 列
        c.execute('ALTER TABLE scores ADD COLUMN completion INTEGER DEFAULT 0')
    
    try:
        # 检查 difficulty 列是否存在
        c.execute('SELECT difficulty FROM scores LIMIT 1')
    except sqlite3.OperationalError:
        # 如果不存在，添加 difficulty 列
        c.execute('ALTER TABLE scores ADD COLUMN difficulty INTEGER NOT NULL DEFAULT 0')
    
    try:
        # 检查 region 列是否存在
        c.execute('SELECT region FROM scores LIMIT 1')
    except sqlite3.OperationalError:
        # 如果不存在，添加 region 列
        c.execute('ALTER TABLE scores ADD COLUMN region TEXT NOT NULL DEFAULT "CN"')
    
    try:
        # 检查 is_favorite 列是否存在
        c.execute('SELECT is_favorite FROM scores LIMIT 1')
    except sqlite3.OperationalError:
        # 如果不存在，添加 is_favorite 列
        c.execute('ALTER TABLE scores ADD COLUMN is_favorite BOOLEAN DEFAULT 0')
    
    try:
        # 检查 created_at 列是否存在
        c.execute('SELECT created_at FROM scores LIMIT 1')
    except sqlite3.OperationalError:
        # 如果不存在，添加 created_at 列
        c.execute('ALTER TABLE scores ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
    
    # 新建随机池表，升级支持origin_codes_json
    try:
        c.execute('ALTER TABLE random_pools ADD COLUMN origin_codes_json TEXT')
    except Exception:
        pass
    c.execute('''
        CREATE TABLE IF NOT EXISTS random_pools (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            filter_json TEXT NOT NULL,
            codes_json TEXT NOT NULL,
            origin_codes_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    conn.commit()
    conn.close()

def init_reviews_db():
    conn = sqlite3.connect('reviews.db')
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            score_code TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
            comment TEXT,
            video_path TEXT,
            is_top BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_reviews_score ON reviews(score_code)')
    conn.commit()
    conn.close()

# 初始化数据库
init_db()

# 初始化评价数据库
init_reviews_db()

# ========== API爬虫相关函数 ==========

def fetch_jianshang_api_page(session, page, timeout=12):
    """获取单页鉴赏数据"""
    params = dict(JIANSHANG_API_PARAMS, page=page)
    try:
        resp = session.get(
            jianshang_api_url,
            params=params,
            headers=JIANSHANG_API_HEADERS,
            timeout=timeout
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("retcode") != 0:
            raise RuntimeError(f"API返回错误: retcode={data.get('retcode')}, message={data.get('message')}")
        return data
    except Exception as e:
        print(f"获取第{page}页数据失败: {e}")
        raise

def extract_share_codes_from_api_response(payload):
    """从API响应中提取share_code字段"""
    data = payload.get("data") or {}
    slide = data.get("slide") or {}
    work_list = slide.get("work_list") or []
    
    share_codes = []
    for work in work_list:
        share_code = work.get("share_code")
        if share_code and isinstance(share_code, str) and share_code.isdigit() and len(share_code) >= 5:
            share_codes.append(share_code)
    
    return share_codes

def crawl_all_jianshang_codes(max_pages=50, sleep_sec=0.3):
    """爬取所有鉴赏码"""
    session = requests.Session()
    page = 1
    all_share_codes = []
    seen_codes = set()
    
    for _ in range(max_pages):
        try:
            payload = fetch_jianshang_api_page(session, page)
            share_codes = extract_share_codes_from_api_response(payload)
            
            print(f"第{page}页 -> 找到{len(share_codes)}个曲谱码")
            
            # 去重并添加到结果
            for code in share_codes:
                if code not in seen_codes:
                    seen_codes.add(code)
                    all_share_codes.append(code)
            
            # 检查是否还有更多数据
            data = payload.get("data") or {}
            slide = data.get("slide") or {}
            work_list = slide.get("work_list") or []
            
            if len(work_list) < JIANSHANG_API_PARAMS["page_size"]:
                print(f"第{page}页数据不足，停止爬取")
                break
                
            page += 1
            time.sleep(sleep_sec)  # 限速防止被封
            
        except Exception as e:
            print(f"获取第{page}页失败: {e}")
            break
    
    return all_share_codes

# 存储上一次的剪贴板内容
last_clipboard_content = ''
current_score_code = None

def is_valid_score_code(text):
    """检查是否是有效的曲谱码（纯数字且长度至少为5位）"""
    return bool(re.match(r'^\d{5,}$', text))

def is_valid_completion(text):
    """检查是否是有效的完成率（0-100的整数）"""
    try:
        value = int(text)
        return 0 <= value <= 100
    except:
        return False

def check_clipboard():
    """监控剪贴板变化"""
    global last_clipboard_content, current_score_code
    retry_count = 0
    max_retries = 3
    retry_delay = 1  # 重试延迟（秒）
    
    print("剪贴板监控线程开始运行...")
    
    while True:
        try:
            current_content = pyperclip.paste()
            if current_content and current_content != last_clipboard_content:
                last_clipboard_content = current_content
                print(f"检测到剪贴板变化: {current_content}")
                
                # 检查是否是有效的曲谱码
                if is_valid_score_code(current_content):
                    print(f"检测到有效曲谱码: {current_content}")
                    current_score_code = current_content
                    # 检查数据库中是否存在该曲谱码（原有）
                    conn = sqlite3.connect('scores.db')
                    c = conn.cursor()
                    c.execute('SELECT completion, is_favorite FROM scores WHERE score_code = ? ORDER BY created_at DESC LIMIT 1', (current_content,))
                    result = c.fetchone()
                    conn.close()

                    # 新增：检查是否有评价（喜欢）
                    conn_r = sqlite3.connect('reviews.db')
                    cr = conn_r.cursor()
                    cr.execute('SELECT 1 FROM reviews WHERE score_code = ? LIMIT 1', (current_content,))
                    has_review = cr.fetchone() is not None
                    conn_r.close()

                    # 发送曲谱码到前端（新增 has_review）
                    socketio.emit('clipboard_update', {
                        'type': 'score_code',
                        'score_code': current_content,
                        'exists': bool(result),
                        'completion': result[0] if result else None,
                        'is_favorite': result[1] if result else False,
                        'has_review': has_review
                    })
                    print(f"已发送曲谱码到前端: {current_content}")
            retry_count = 0  # 重置重试计数
        except Exception as e:
            retry_count += 1
            if retry_count >= max_retries:
                print(f"剪贴板监控错误: {e}，已达到最大重试次数")
                retry_count = 0
                time.sleep(retry_delay * 2)  # 增加更长的等待时间
            else:
                print(f"剪贴板监控错误: {e}，正在重试 ({retry_count}/{max_retries})")
                time.sleep(retry_delay)
            continue
        time.sleep(0.5)  # 每0.5秒检查一次

# 启动剪贴板监控线程
clipboard_thread = threading.Thread(target=check_clipboard, daemon=True, name="ClipboardMonitor")
clipboard_thread.start()
print(f"剪贴板监控线程已启动: {clipboard_thread.name}")

# 添加线程状态检查函数
def check_thread_status():
    """检查所有活动线程状态"""
    import threading
    active_threads = threading.enumerate()
    print(f"当前活动线程 ({len(active_threads)}):")
    for thread in active_threads:
        print(f"  - {thread.name}: {'alive' if thread.is_alive() else 'dead'}")

# 在启动后检查线程状态
check_thread_status()

@app.route('/uploads/videos/<path:filename>')
def serve_uploaded_video(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename, as_attachment=False)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/scores', methods=['GET'])
def get_scores():
    try:
        # 获取筛选参数
        min_completion = request.args.get('min_completion', type=int)
        max_completion = request.args.get('max_completion', type=int)
        favorite_filter = request.args.get('favorite', type=int)  # 0: 全部, 1: 收藏, 2: 未收藏
        
        conn = sqlite3.connect('scores.db')
        c = conn.cursor()
        
        # 构建查询条件
        conditions = []
        params = []
        
        if min_completion is not None:
            conditions.append('completion >= ?')
            params.append(min_completion)
        if max_completion is not None:
            conditions.append('completion <= ?')
            params.append(max_completion)
        if favorite_filter is not None:
            if favorite_filter == 1:
                conditions.append('is_favorite = 1')
            elif favorite_filter == 2:
                conditions.append('is_favorite = 0')
        
        # 构建SQL查询
        query = '''
        SELECT score_code, completion, is_favorite, created_at 
        FROM scores 
        '''
        if conditions:
            query += ' WHERE ' + ' AND '.join(conditions)
        query += ' ORDER BY created_at DESC'
        
        c.execute(query, params)
        rows = c.fetchall()
        conn.close()

        # —— 新增：批量查询这些 code 是否有评价 ——
        codes = [r[0] for r in rows]
        has_map = set()
        if codes:
            conn_r = sqlite3.connect('reviews.db')
            cr = conn_r.cursor()
            placeholders = ','.join(['?']*len(codes))
            cr.execute(f'SELECT DISTINCT score_code FROM reviews WHERE score_code IN ({placeholders})', codes)
            has_map = {t[0] for t in cr.fetchall()}
            conn_r.close()

        return jsonify([{
            'score_code': s[0],
            'completion': s[1],
            'is_favorite': bool(s[2]),
            'created_at': s[3],
            'has_review': s[0] in has_map   # ★ 新增字段
        } for s in rows])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/scores/save', methods=['POST'])
def save_score():
    try:
        data = request.get_json()
        score_code = data.get('score_code')
        completion = data.get('completion')
        
        if not score_code or not is_valid_score_code(score_code):
            return jsonify({'success': False, 'error': '无效的曲谱码'}), 400
            
        if not is_valid_completion(str(completion)):
            return jsonify({'success': False, 'error': '无效的完成率'}), 400
        
        conn = sqlite3.connect('scores.db')
        c = conn.cursor()
        
        # 检查曲谱码是否存在
        c.execute('SELECT id FROM scores WHERE score_code = ? ORDER BY created_at DESC LIMIT 1', (score_code,))
        existing_record = c.fetchone()
        
        if existing_record:
            # 如果存在，更新记录
            c.execute('''
                UPDATE scores 
                SET completion = ?, created_at = CURRENT_TIMESTAMP
                WHERE score_code = ?
            ''', (completion, score_code))
        else:
            # 如果不存在，创建新记录
            c.execute('''
                INSERT INTO scores (score_code, completion, difficulty, region, created_at) 
                VALUES (?, ?, 0, 'CN', CURRENT_TIMESTAMP)
            ''', (score_code, completion))
        
        conn.commit()
        conn.close()
        
        # 发送完成率到前端
        socketio.emit('clipboard_update', {
            'type': 'completion',
            'score_code': score_code,
            'completion': completion,
            'message': '保存成功'
        })
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/scores/<score_code>/favorite', methods=['POST'])
def toggle_favorite(score_code):
    try:
        conn = sqlite3.connect('scores.db')
        c = conn.cursor()
        # 获取当前收藏状态
        c.execute('SELECT is_favorite FROM scores WHERE score_code = ? ORDER BY created_at DESC LIMIT 1', (score_code,))
        result = c.fetchone()
        
        if result:
            # 更新收藏状态
            new_status = not result[0]
            c.execute('UPDATE scores SET is_favorite = ?, created_at = CURRENT_TIMESTAMP WHERE score_code = ?', (new_status, score_code))
            conn.commit()
            conn.close()
            
            # 发送更新到前端
            socketio.emit('favorite_update', {
                'score_code': score_code,
                'is_favorite': new_status
            })
            
            return jsonify({'success': True, 'is_favorite': new_status})
        else:
            # 如果记录不存在，创建新记录并标记为收藏
            c.execute('''
                INSERT INTO scores (score_code, completion, difficulty, region, is_favorite, created_at) 
                VALUES (?, 0, 0, 'CN', 1, CURRENT_TIMESTAMP)
            ''', (score_code,))
            conn.commit()
            conn.close()
            
            # 发送更新到前端
            socketio.emit('favorite_update', {
                'score_code': score_code,
                'is_favorite': True
            })
            
            return jsonify({'success': True, 'is_favorite': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/scores/stats', methods=['GET'])
def get_stats():
    try:
        conn = sqlite3.connect('scores.db')
        c = conn.cursor()
        
        # 获取总记录数
        c.execute('SELECT COUNT(*) FROM scores')
        total_records = c.fetchone()[0]
        
        # 获取收藏歌曲数
        c.execute('SELECT COUNT(DISTINCT score_code) FROM scores WHERE is_favorite = 1')
        favorite_songs = c.fetchone()[0]

        conn.close()

        return jsonify({
            'total_records': total_records,
            'favorite_songs': favorite_songs
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/batch')
def batch_query():
    return render_template('batch_query.html', initial_chrome_initialized=False)

@app.route('/api/scores/batch', methods=['POST'])
def batch_query_scores():
    try:
        data = request.get_json()
        score_codes = data.get('score_codes', [])
        exclude_codes = data.get('exclude_codes', [])
        min_completion = data.get('min_completion')
        max_completion = data.get('max_completion')
        favorite = data.get('favorite')

        # 调试打印参数
        #print("score_codes:", score_codes)
        #print("exclude_codes:", exclude_codes)
#
        conn = sqlite3.connect('scores.db')
        c = conn.cursor()

        # 如果 score_codes 为空，则查所有曲谱码
        if not score_codes:
            c.execute("SELECT DISTINCT score_code FROM scores")
            score_codes = [row[0] for row in c.fetchall()]

        if not score_codes:
            conn.close()
            return jsonify({'success': False, 'error': '未提供曲谱码'}), 400

        # 验证所有曲谱码都是有效的
        if not all(is_valid_score_code(code) for code in score_codes):
            return jsonify({'success': False, 'error': '包含无效的曲谱码'}), 400

        # 只查所有 score_codes
        c.execute(
            f"SELECT score_code, completion, is_favorite FROM scores WHERE score_code IN ({','.join(['?']*len(score_codes))}) GROUP BY score_code ORDER BY MAX(created_at) DESC",
            score_codes
        )
        db_results = {row[0]: row for row in c.fetchall()}
        conn.close()

        # 先排除 exclude_codes
        results = []
        for code in score_codes:
            if code in exclude_codes:
                continue
            row = db_results.get(code)
            if not row:
                # 数据库没有的曲谱码也要返回（如 completion=None, is_favorite=False）
                results.append({'score_code': code, 'completion': None, 'is_favorite': False})
                continue
            results.append({
                'score_code': row[0],
                'completion': row[1],
                'is_favorite': bool(row[2])
            })

        # 排除后打印结果
        print("results after exclude:", [r['score_code'] for r in results])

        # 再根据完成率/收藏筛选
        if min_completion is not None:
            results = [r for r in results if r['completion'] is not None and r['completion'] >= min_completion]
        if max_completion is not None:
            results = [r for r in results if r['completion'] is not None and r['completion'] <= max_completion]
        if favorite is not None:
            try:
                favorite = int(favorite)
                if favorite == 1:
                    results = [r for r in results if r['is_favorite']]
                elif favorite == 2:
                    results = [r for r in results if not r['is_favorite']]
            except:
                pass

        # —— 新增：批量查询喜欢 ——
        all_codes = [r['score_code'] for r in results]
        has_map = set()
        if all_codes:
            conn_r = sqlite3.connect('reviews.db')
            cr = conn_r.cursor()
            placeholders = ','.join(['?']*len(all_codes))
            cr.execute(f'SELECT DISTINCT score_code FROM reviews WHERE score_code IN ({placeholders})', all_codes)
            has_map = {t[0] for t in cr.fetchall()}
            conn_r.close()

        for r in results:
            r['has_review'] = r['score_code'] in has_map  # ★ 新增字段

        return jsonify({
            'success': True,
            'results': results,
            'total': len(score_codes),
            'found': len(results)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Selenium浏览器相关代码已移除，使用API爬虫替代

@app.route('/api/fetch_jianshang', methods=['GET'])
def fetch_jianshang():
    try:
        print("开始通过API获取鉴赏码...")
        
        # 使用API爬取鉴赏码
        score_codes = crawl_all_jianshang_codes(max_pages=50, sleep_sec=0.3)
        
        if not score_codes:
            return jsonify({
                'success': False,
                'error': '未找到任何曲谱码'
            }), 404
        
        print(f"共找到 {len(score_codes)} 个曲谱码")
        
        # 批量查询这些曲谱码
        conn = sqlite3.connect('scores.db')
        c = conn.cursor()
        
        results = []
        for score_code in score_codes:
            c.execute('''
                SELECT score_code, completion, is_favorite 
                FROM scores 
                WHERE score_code = ? 
                ORDER BY created_at DESC 
                LIMIT 1
            ''', (score_code,))
            result = c.fetchone()
            
            if result:
                results.append({
                    'score_code': result[0],
                    'completion': result[1],
                    'is_favorite': bool(result[2])
                })
            else:
                results.append({
                    'score_code': score_code,
                    'completion': None,
                    'is_favorite': False
                })
        
        conn.close()
        
        # 保存曲谱码到文件
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        # 确保目录存在
        output_dir = 'The old appreciation code'
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
        filename = os.path.join(output_dir, f'score_codes_{timestamp}.txt')
        with open(filename, 'w', encoding='utf-8') as f:
            for code in score_codes:
                f.write(f'{code}\n')
        
        return jsonify({
            'success': True,
            'results': results,
            'total': len(score_codes),
            'found': len([r for r in results if r['completion'] is not None]),
            'filename': os.path.basename(filename),
            'extracted_count': len(score_codes)
        })
            
    except Exception as e:
        print(f"通过API获取鉴赏码时发生错误: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/latest_jianshang_codes', methods=['GET'])
def get_latest_jianshang_codes():
    try:
        print("收到获取最新鉴赏码的请求")
        # 查找最新的鉴赏码文件
        output_dir = 'The old appreciation code'
        print(f"检查目录: {output_dir}")
        if not os.path.exists(output_dir):
            print("鉴赏码目录不存在")
            return jsonify({'success': False, 'error': '鉴赏码目录不存在', 'filename': None, 'extracted_count': 0}), 404
        
        # 获取目录中的所有文件
        # 找到最新的文件，优先选择非今天的文件
        latest_file = None
        latest_timestamp = 0
        today_latest_file = None
        today_latest_timestamp = 0
        
        current_date_str = datetime.now().strftime('%Y%m%d')

        files = os.listdir(output_dir)
        for f in files:
            if f.startswith('score_codes_') and f.endswith('.txt'):
                try:
                    timestamp_str = f.replace('score_codes_', '').replace('.txt', '')
                    file_date_str = timestamp_str.split('_')[0]
                    timestamp = datetime.strptime(timestamp_str, '%Y%m%d_%H%M%S').timestamp()
                    
                    if file_date_str == current_date_str:
                        # 如果是今天的文件，记录下来，但不作为首选
                        if timestamp > today_latest_timestamp:
                            today_latest_timestamp = timestamp
                            today_latest_file = f
                    else:
                        # 如果不是今天的文件，正常比较
                        if timestamp > latest_timestamp:
                            latest_timestamp = timestamp
                            latest_file = f
                except ValueError:
                    continue

        # 如果找到了非今天的文件，则使用它
        if latest_file:
            pass
        # 否则，如果只找到了今天的文件，则使用最新的今天的文件
        elif today_latest_file:
            latest_file = today_latest_file
        # 如果都没有找到，则 latest_file 仍然是 None

        if not latest_file:
            print("未找到任何鉴赏码文件")
            return jsonify({'success': False, 'error': '未找到任何鉴赏码文件', 'filename': None, 'extracted_count': 0}), 404

        file_path = os.path.join(output_dir, latest_file)
        print(f"找到最新鉴赏码文件: {file_path}")

        codes = []
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                code = line.strip()
                if code:
                    codes.append(code)
        
        print(f"从文件 {latest_file} 中提取了 {len(codes)} 个鉴赏码")
        return jsonify({
            'success': True,
            'codes': codes,
            'filename': latest_file,
            'extracted_count': len(codes)
        })
        files = os.listdir(output_dir)
        print(f"目录中的文件: {files}")
        if not files:
            print("没有找到鉴赏码文件")
            return jsonify({'success': False, 'error': '没有找到鉴赏码文件'}), 404
        
        # 过滤出txt文件并按时间排序
        txt_files = [f for f in files if f.endswith('.txt')]
        print(f"txt文件: {txt_files}")
        if not txt_files:
            print("没有找到txt格式的鉴赏码文件")
            return jsonify({'success': False, 'error': '没有找到鉴赏码文件'}), 404
        
        # 按文件名排序，最新的文件应该在最后面（因为文件名包含时间戳）
        txt_files.sort()
        latest_file = txt_files[-1]  # 获取最新的文件
        print(f"最新的文件: {latest_file}")
        
        # 读取文件内容
        file_path = os.path.join(output_dir, latest_file)
        print(f"读取文件路径: {file_path}")
        with open(file_path, 'r', encoding='utf-8') as f:
            codes = [line.strip() for line in f.readlines() if line.strip()]
        print(f"读取到的码数量: {len(codes)}")
        
        result = {
            'success': True,
            'codes': codes,
            'file_name': latest_file
        }
        print(f"返回结果: {result}")
        return jsonify(result)
    except Exception as e:
        print(f"获取最新鉴赏码时发生错误: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

def start_server():
    """启动Flask服务器"""
    import socket
    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)

    # 检查端口是否被占用
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(('0.0.0.0', 6605))
        sock.close()
        # 端口可用，启动服务器
        url = f"http://{local_ip}:6605"
        pyperclip.copy(url)
        print(f"服务器启动在: {url} (已复制到剪贴板)")
        # 自动打开浏览器并访问剪贴板中的URL
        try:
            clipboard_content = pyperclip.paste()
            if clipboard_content.startswith('http'):
                print(f"正在打开浏览器访问: {clipboard_content}")
                webbrowser.open(clipboard_content)
            else:
                print("剪贴板中没有有效的URL，打开默认地址")
                webbrowser.open(url)
        except Exception as e:
            print(f"无法自动打开浏览器: {e}")
            print("请手动打开浏览器并访问:", url)
        socketio.run(app, host='0.0.0.0', port=6605, debug=False, allow_unsafe_werkzeug=True)
    except OSError as e:
        print(f"端口6605被占用，尝试使用其他端口: {e}")
        # 尝试其他端口
        for port in [6606, 6607, 6608, 5000, 8080]:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.bind(('0.0.0.0', port))
                sock.close()
                print(f"使用备用端口: {port}")
                url = f"http://{local_ip}:{port}"
                pyperclip.copy(url)
                print(f"服务器启动在: {url} (已复制到剪贴板)")
                # 自动打开浏览器并访问剪贴板中的URL
                try:
                    clipboard_content = pyperclip.paste()
                    if clipboard_content.startswith('http'):
                        print(f"正在打开浏览器访问: {clipboard_content}")
                        webbrowser.open(clipboard_content)
                    else:
                        print("剪贴板中没有有效的URL，打开默认地址")
                        webbrowser.open(url)
                except Exception as e:
                    print(f"无法自动打开浏览器: {e}")
                    print("请手动打开浏览器并访问:", url)
                socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
                break
            except OSError:
                continue
        else:
            print("所有备用端口都被占用，无法启动服务器")
            return

# ========== 随机池相关API ==========
from flask import abort

@app.route('/api/random_pool/create', methods=['POST'])
def create_random_pool():
    try:
        data = request.get_json()
        name = data.get('name')
        filter_obj = data.get('filter')  # dict
        codes = data.get('codes')
        if not name:
            return jsonify({'success': False, 'error': '池名不能为空'}), 400
        if filter_obj is None:
            filter_obj = {}
        conn = sqlite3.connect('scores.db')
        c = conn.cursor()
        if codes is not None:
            codes = [c_ for c_ in codes if isinstance(c_, str) and c_.isdigit() and len(c_) >= 5]
        else:
            min_completion = filter_obj.get('min_completion')
            max_completion = filter_obj.get('max_completion')
            favorite = filter_obj.get('favorite')
            conditions = []
            params = []
            if min_completion is not None:
                conditions.append('completion >= ?')
                params.append(min_completion)
            if max_completion is not None:
                conditions.append('completion <= ?')
                params.append(max_completion)
            if favorite is not None:
                if favorite == 1:
                    conditions.append('is_favorite = 1')
                elif favorite == 2:
                    conditions.append('is_favorite = 0')
            query = 'SELECT DISTINCT score_code FROM scores'
            if conditions:
                query += ' WHERE ' + ' AND '.join(conditions)
            c.execute(query, params)
            codes = [row[0] for row in c.fetchall()]
        # 存入random_pools表，origin_codes_json也写入
        c.execute('INSERT INTO random_pools (name, filter_json, codes_json, origin_codes_json) VALUES (?, ?, ?, ?)',
                  (name, json.dumps(filter_obj, ensure_ascii=False), json.dumps(codes, ensure_ascii=False), json.dumps(codes, ensure_ascii=False)))
        pool_id = c.lastrowid
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'id': pool_id, 'name': name, 'filter': filter_obj, 'codes': codes})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/random_pool/list', methods=['GET'])
def list_random_pools():
    try:
        conn = sqlite3.connect('scores.db')
        c = conn.cursor()
        c.execute('SELECT id, name, filter_json, codes_json, created_at FROM random_pools ORDER BY created_at DESC')
        pools = [
            {
                'id': row[0],
                'name': row[1],
                'filter': json.loads(row[2]),
                'codes': json.loads(row[3]),
                'created_at': row[4]
            } for row in c.fetchall()
        ]
        conn.close()
        return jsonify({'success': True, 'pools': pools})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/random_pool/<int:pool_id>/random', methods=['POST'])
def random_from_pool(pool_id):
    try:
        conn = sqlite3.connect('scores.db')
        c = conn.cursor()
        c.execute('SELECT codes_json FROM random_pools WHERE id = ?', (pool_id,))
        row = c.fetchone()
        if not row:
            conn.close()
            return jsonify({'success': False, 'error': '池不存在'}), 404
        codes = json.loads(row[0])
        if not codes:
            conn.close()
            return jsonify({'success': False, 'error': '池已空'}), 400
        import random
        idx = random.randint(0, len(codes)-1)
        code = codes.pop(idx)
        # 只在这里更新codes_json
        c.execute('UPDATE random_pools SET codes_json = ? WHERE id = ?', (json.dumps(codes, ensure_ascii=False), pool_id))
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'code': code, 'remain': len(codes)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/random_pool/<int:pool_id>/delete', methods=['POST'])
def delete_pool(pool_id):
    try:
        conn = sqlite3.connect('scores.db')
        c = conn.cursor()
        c.execute('DELETE FROM random_pools WHERE id = ?', (pool_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/random_pool/<int:pool_id>/filter', methods=['POST'])
def filter_pool(pool_id):
    try:
        data = request.get_json()
        filter_obj = data.get('filter')
        codes_override = data.get('codes')
        if filter_obj is None:
            filter_obj = {}
        conn = sqlite3.connect('scores.db')
        c = conn.cursor()
        c.execute('SELECT origin_codes_json FROM random_pools WHERE id = ?', (pool_id,))
        row = c.fetchone()
        if not row:
            conn.close()
            return jsonify({'success': False, 'error': '池不存在'}), 404
        origin_codes = json.loads(row[0])
        # 支持前端传codes（如排除/查询），否则用origin_codes
        codes = codes_override if codes_override is not None else origin_codes
        min_completion = filter_obj.get('min_completion')
        max_completion = filter_obj.get('max_completion')
        favorite = filter_obj.get('favorite')
        if not codes:
            c.execute('UPDATE random_pools SET codes_json = ? WHERE id = ?', (json.dumps([]), pool_id))
            conn.commit()
            conn.close()
            return jsonify({'success': True, 'codes': []})
        # 如果筛选条件全空，恢复为origin_codes
        if not min_completion and not max_completion and not favorite and codes_override is None:
            c.execute('UPDATE random_pools SET codes_json = ? WHERE id = ?', (json.dumps(origin_codes), pool_id))
            conn.commit()
            conn.close()
            return jsonify({'success': True, 'codes': origin_codes})
        placeholders = ','.join(['?']*len(codes))
        query = f'SELECT score_code, completion, is_favorite FROM scores WHERE score_code IN ({placeholders})'
        conditions = []
        params = codes[:]
        if min_completion is not None:
            conditions.append('completion >= ?')
            params.append(min_completion)
        if max_completion is not None:
            conditions.append('completion <= ?')
            params.append(max_completion)
        if favorite is not None:
            if favorite == 1:
                conditions.append('is_favorite = 1')
            elif favorite == 2:
                conditions.append('is_favorite = 0')
        if conditions:
            query += ' AND ' + ' AND '.join(conditions)
        c.execute(query, params)
        filtered = [row[0] for row in c.fetchall()]
        c.execute('UPDATE random_pools SET codes_json = ? WHERE id = ?', (json.dumps(filtered, ensure_ascii=False), pool_id))
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'codes': filtered})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/random_pool/<int:pool_id>/reset', methods=['POST'])
def reset_pool(pool_id):
    try:
        conn = sqlite3.connect('scores.db')
        c = conn.cursor()
        c.execute('SELECT origin_codes_json FROM random_pools WHERE id = ?', (pool_id,))
        row = c.fetchone()
        if not row:
            conn.close()
            return jsonify({'success': False, 'error': '池不存在'}), 404
        origin_codes = row[0]
        c.execute('UPDATE random_pools SET codes_json = ? WHERE id = ?', (origin_codes, pool_id))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/random_pool')
def random_pool():
    return render_template('random_pool.html')

@app.route('/api/reviews', methods=['POST'])
def create_review():
    try:
        # 支持 multipart/form-data
        # 必填：score_code, rating(1-5)
        score_code = request.form.get('score_code', '').strip()
        rating_raw = request.form.get('rating', '').strip()
        comment = (request.form.get('comment') or '').strip()
        is_top_raw = (request.form.get('is_top') or '').strip()
        video = request.files.get('video')

        # 校验
        if not is_valid_score_code(score_code):
            return jsonify({'success': False, 'error': '无效的曲谱码'}), 400

        if not comment:
            return jsonify({'success': False, 'error': '评语不能为空'}), 400

        try:
            rating = int(rating_raw)
            if rating < 1 or rating > 5:
                raise ValueError()
        except Exception:
            return jsonify({'success': False, 'error': '评分必须是 1-5 的整数'}), 400

        # 校验视频文件
        if not video or not video.filename:
            return jsonify({'success': False, 'error': '请上传视频文件'}), 400

        is_top = (is_top_raw.lower() in ('1', 'true', 'on', 'yes'))

        # 保存视频（必填）
        saved_rel_url = None
        if video and video.filename:
            if not allowed_video(video.filename):
                return jsonify({'success': False, 'error': '不支持的视频格式'}), 400
            safe_name = secure_filename(video.filename)
            # 防重名：前缀曲谱码与时间戳
            final_name = f"{score_code}_{int(time.time())}_{safe_name}"
            dst_path = os.path.join(app.config['UPLOAD_FOLDER'], final_name)

            # 确保上传目录存在
            os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

            # 保存原始视频文件到临时位置
            temp_path = None
            try:
                # 创建临时文件保存上传的视频
                temp_fd, temp_path = tempfile.mkstemp(suffix=os.path.splitext(safe_name)[1])
                os.close(temp_fd)
                video.save(temp_path)
                print(f"视频文件已保存到临时位置: {temp_path}")

                # 检查文件大小是否需要压缩
                file_size = os.path.getsize(temp_path)
                print(f"上传的视频文件大小: {file_size / (1024*1024):.2f} MB")

                if file_size > VIDEO_COMPRESS_THRESHOLD:
                    print("文件超过压缩阈值，开始压缩...")
                    # 压缩视频
                    compressed_path = dst_path.replace(os.path.splitext(dst_path)[1], '_compressed.mp4')
                    if compress_video(temp_path, compressed_path, VIDEO_COMPRESS_TARGET_SIZE / (1024*1024)):
                        # 压缩成功，使用压缩后的文件
                        dst_path = compressed_path
                        final_name = os.path.basename(compressed_path)
                        print(f"视频压缩完成，保存到: {dst_path}")
                    else:
                        # 压缩失败，直接保存原始文件
                        print("视频压缩失败，保存原始文件")
                        shutil.move(temp_path, dst_path)
                else:
                    # 文件大小未超过阈值，直接移动文件
                    shutil.move(temp_path, dst_path)
                    print(f"视频文件已保存到: {dst_path}")

                # 清理临时文件
                if temp_path and os.path.exists(temp_path):
                    os.remove(temp_path)

            except Exception as save_error:
                # 清理临时文件
                if temp_path and os.path.exists(temp_path):
                    os.remove(temp_path)
                print(f"保存视频文件时出错: {str(save_error)}")
                import traceback
                traceback.print_exc()
                return jsonify({'success': False, 'error': f'保存视频文件失败: {str(save_error)}'}), 500

            # 前端可直接访问的相对 URL
            saved_rel_url = f"/uploads/videos/{final_name}"

        # 入库
        conn = sqlite3.connect('reviews.db')
        c = conn.cursor()
        c.execute('''
            INSERT INTO reviews (score_code, rating, comment, video_path, is_top)
            VALUES (?, ?, ?, ?, ?)
        ''', (score_code, rating, comment, saved_rel_url, 1 if is_top else 0))
        conn.commit()
        new_id = c.lastrowid
        conn.close()

        return jsonify({
            'success': True,
            'id': new_id,
            'score_code': score_code,
            'rating': rating,
            'comment': comment,
            'video_url': saved_rel_url,
            'is_top': is_top
        })
    except Exception as e:
        # 打印详细错误信息以便调试
        import traceback
        error_info = traceback.format_exc()
        print(f"创建评价时出错: {str(e)}")
        print(f"详细错误信息:\n{error_info}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/reviews/status')
def review_status():
    score_code = (request.args.get('score_code') or '').strip()
    if not is_valid_score_code(score_code):
        return jsonify({'success': False, 'error': '无效的曲谱码'}), 400
    conn = sqlite3.connect('reviews.db')
    c = conn.cursor()
    c.execute('SELECT 1 FROM reviews WHERE score_code = ? LIMIT 1', (score_code,))
    has = c.fetchone() is not None
    conn.close()
    return jsonify({'success': True, 'has_review': has})


@app.route('/api/reviews/<score_code>', methods=['GET'])
def get_review(score_code):
    if not is_valid_score_code(score_code):
        return jsonify({'success': False, 'error': '无效的曲谱码'}), 400
    conn = sqlite3.connect('reviews.db')
    c = conn.cursor()
    c.execute('''
        SELECT rating, comment, video_path, created_at
        FROM reviews
        WHERE score_code = ?
        ORDER BY created_at DESC
        LIMIT 1
    ''', (score_code,))
    row = c.fetchone()
    conn.close()
    if not row:
        return jsonify({'success': True, 'has_review': False})
    return jsonify({
        'success': True,
        'has_review': True,
        'score_code': score_code,
        'rating': row[0],
        'comment': row[1] or '',
        'video_url': row[2],
        'created_at': row[3],
    })

# ========= 喜欢列表 API =========

@app.route('/likes')
def likes_page():
    # 渲染专用页面
    return render_template('likes.html')


@app.route('/api/reviews/liked', methods=['GET'])
def list_liked_reviews():
    """
    返回"已喜欢（有评价）"的谱子列表（每个谱子取最新一条评价）
    支持筛选：
      - q: 关键字（匹配 score_code / comment）
      - min_rating: 最低评分 1-5
      - has_video: 1 只要有视频，0/缺省不过滤
      - sort: latest(默认) / rating_desc / rating_asc
      - limit / offset: 分页，默认 100 / 0
    """
    try:
        q = (request.args.get('q') or '').strip()
        min_rating = request.args.get('min_rating', type=int)
        has_video = request.args.get('has_video', type=int)
        sort = (request.args.get('sort') or 'latest').lower()
        limit = request.args.get('limit', default=100, type=int)
        offset = request.args.get('offset', default=0, type=int)

        # 1) 取每个 score_code 最新的一条 review
        conn_r = sqlite3.connect('reviews.db')
        cr = conn_r.cursor()

        where = []
        params = []

        if min_rating is not None:
            where.append('r.rating >= ?')
            params.append(min_rating)

        if has_video == 1:
            where.append('r.video_path IS NOT NULL AND r.video_path <> ""')

        if q:
            where.append('(r.score_code LIKE ? OR r.comment LIKE ?)')
            params.extend([f'%{q}%', f'%{q}%'])

        where_sql = (' WHERE ' + ' AND '.join(where)) if where else ''

        order_sql = 'ORDER BY r.created_at DESC'
        if sort == 'rating_desc':
            order_sql = 'ORDER BY r.rating DESC, r.created_at DESC'
        elif sort == 'rating_asc':
            order_sql = 'ORDER BY r.rating ASC, r.created_at DESC'

        sql = f'''
            SELECT r.score_code, r.rating, r.comment, r.video_path, r.created_at
            FROM reviews r
            JOIN (
                SELECT score_code, MAX(created_at) AS latest_time
                FROM reviews
                GROUP BY score_code
            ) lr ON r.score_code = lr.score_code AND r.created_at = lr.latest_time
            {where_sql}
            {order_sql}
            LIMIT ? OFFSET ?
        '''
        params_ext = params + [limit, offset]
        cr.execute(sql, params_ext)
        rows = cr.fetchall()
        conn_r.close()

        # 2) 取这些谱子的最新完成率 & 收藏态（scores.db）
        codes = [r[0] for r in rows]
        completion_map = {}
        favorite_map = {}
        if codes:
            conn_s = sqlite3.connect('scores.db')
            cs = conn_s.cursor()
            ph = ','.join(['?'] * len(codes))
            cs.execute(f'''
                SELECT s.score_code, s.completion, s.is_favorite
                FROM scores s
                JOIN (
                    SELECT score_code, MAX(created_at) AS latest_time
                    FROM scores
                    GROUP BY score_code
                ) ls ON s.score_code = ls.score_code AND s.created_at = ls.latest_time
                WHERE s.score_code IN ({ph})
            ''', codes)
            for code, comp, fav in cs.fetchall():
                completion_map[code] = comp
                favorite_map[code] = bool(fav)
            conn_s.close()

        # 3) 拼装返回
        data = []
        for code, rating, comment, video_path, created_at in rows:
            data.append({
                'score_code': code,
                'rating': rating,
                'comment': comment or '',
                'video_url': video_path,
                'created_at': created_at,
                'completion': completion_map.get(code),
                'is_favorite': favorite_map.get(code, False)
            })

        return jsonify({'success': True, 'results': data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# 自定义错误处理器
@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(e):
    return jsonify({
        'success': False,
        'error': f'文件太大了！请上传小于500MB的文件，或使用视频压缩功能。'
    }), 413

if __name__ == '__main__':
    # 启动时备份数据库
    backup_database()

    print("千音雅集服务器启动 - 使用API爬虫模式")

    # 直接启动服务器（不使用线程）
    start_server()