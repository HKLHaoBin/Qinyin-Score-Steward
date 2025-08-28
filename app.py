from flask import Flask, render_template, request, jsonify
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
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
import json
from webdriver_manager.chrome import ChromeDriverManager

app = Flask(__name__)
socketio = SocketIO(app, async_mode='threading', cors_allowed_origins="*")

# 全局变量
chrome_options = None
driver = None
jianshang_url = "https://act.miyoushe.com/ys/event/ugc-music-stable/index.html?mhy_presentation_style=fullscreen&mhy_auth_required=true&game_biz=hk4e_cn#/list?key=Button_Jianshang&is_from_button=true"
chrome_initialized = False  # 添加初始化状态标志

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

# 初始化数据库
init_db()

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
                    # 检查数据库中是否存在该曲谱码
                    conn = sqlite3.connect('scores.db')
                    c = conn.cursor()
                    c.execute('SELECT completion, is_favorite FROM scores WHERE score_code = ? ORDER BY created_at DESC LIMIT 1', (current_content,))
                    result = c.fetchone()
                    conn.close()
                    
                    # 发送曲谱码到前端
                    socketio.emit('clipboard_update', {
                        'type': 'score_code',
                        'score_code': current_content,
                        'exists': bool(result),
                        'completion': result[0] if result else None,
                        'is_favorite': result[1] if result else False
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
        scores = c.fetchall()
        conn.close()
        
        return jsonify([{
            'score_code': s[0],
            'completion': s[1],
            'is_favorite': bool(s[2]),
            'created_at': s[3]
        } for s in scores])
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
        
        # 获取不同曲谱码数量
        c.execute('SELECT COUNT(DISTINCT score_code) FROM scores')
        unique_songs = c.fetchone()[0]
        
        # 获取收藏歌曲数
        c.execute('SELECT COUNT(DISTINCT score_code) FROM scores WHERE is_favorite = 1')
        favorite_songs = c.fetchone()[0]
        
        conn.close()
        
        return jsonify({
            'total_records': total_records,
            'unique_songs': unique_songs,
            'favorite_songs': favorite_songs
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/batch')
def batch_query():
    global chrome_initialized
    return render_template('batch_query.html', initial_chrome_initialized=chrome_initialized)

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

        return jsonify({
            'success': True,
            'results': results,
            'total': len(score_codes),
            'found': len(results)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

def init_chrome():
    """初始化Chrome浏览器"""
    global chrome_options, driver, chrome_initialized
    if driver is not None:
        try:
            driver.quit()
        except:
            pass
    
    chrome_options = Options()
    chrome_options.add_argument('--headless=new')
    chrome_options.add_argument('--disable-gpu')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--disable-software-rasterizer')
    chrome_options.add_argument('--disable-webgl')
    chrome_options.add_argument('--disable-webgl2')
    chrome_options.add_argument('--disable-extensions')
    chrome_options.add_argument('--disable-logging')
    chrome_options.add_argument('--log-level=3')
    chrome_options.add_argument('--silent')
    chrome_options.add_argument('--disable-gpu-sandbox')
    chrome_options.add_argument('--disable-setuid-sandbox')
    chrome_options.add_argument('--disable-accelerated-2d-canvas')
    chrome_options.add_argument('--disable-accelerated-video-decode')
    chrome_options.add_experimental_option('excludeSwitches', ['enable-logging'])
    
    print("Chrome Options:")
    for arg in chrome_options.arguments:
        print(f"  {arg}")
    
    try:
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(options=chrome_options, service=service)
        driver.set_page_load_timeout(30)
        driver.get(jianshang_url)
        
        # 等待页面加载完成
        wait = WebDriverWait(driver, 20)
        wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        
        print("Chrome浏览器初始化成功")
        chrome_initialized = True
        socketio.emit('chrome_init_status', {'success': True, 'message': 'Chrome浏览器初始化成功'})
        return True
    except Exception as e:
        print(f"Chrome浏览器初始化失败: {type(e).__name__} - {e}")
        import traceback
        traceback.print_exc()
        if driver is not None:
            try:
                driver.quit()
            except:
                pass
        driver = None
        chrome_initialized = False
        socketio.emit('chrome_init_status', {'success': False, 'message': 'Chrome浏览器初始化失败'})
        return False

def init_chrome_async():
    """异步初始化Chrome浏览器"""
    def init():
        time.sleep(5)  # 等待服务器完全启动
        retry_count = 0
        max_retries = 5
        retry_delay = 2  # 重试延迟（秒）
        
        while retry_count < max_retries:
            if init_chrome():
                break
            retry_count += 1
            if retry_count < max_retries:
                print(f"Chrome初始化失败，{retry_delay}秒后重试 ({retry_count}/{max_retries})")
                time.sleep(retry_delay)
    
    thread = threading.Thread(target=init)
    thread.daemon = True
    thread.start()

def scroll_to_bottom():
    """滚动到页面底部"""
    global driver
    if driver is None:
        return False
        
    try:
        last_height = driver.execute_script("return document.body.scrollHeight")
        scroll_attempts = 0
        max_scroll_attempts = 100  # 增加最大滚动次数
        
        while scroll_attempts < max_scroll_attempts:
            # 滚动到底部
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(0.5)  # 减少等待时间
            
            # 检查是否到达底部
            new_height = driver.execute_script("return document.body.scrollHeight")
            if new_height == last_height:
                # 尝试再次滚动，以防万一
                time.sleep(0.5)
                driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(1)
                new_height = driver.execute_script("return document.body.scrollHeight")
                if new_height == last_height:
                    print("已到达页面底部")
                    return True
            last_height = new_height
            scroll_attempts += 1
            print(f"滚动进度: {scroll_attempts}/{max_scroll_attempts}")
            
        return False
    except Exception as e:
        print(f"滚动过程中出现错误: {str(e)}")
        return False

@app.route('/api/fetch_jianshang', methods=['GET'])
def fetch_jianshang():
    try:
        global driver, chrome_initialized
        
        # 检查Chrome是否初始化完成
        if not chrome_initialized:
            # 尝试重新初始化
            retry_count = 0
            max_retries = 5
            while retry_count < max_retries and not chrome_initialized:
                print(f"Chrome未初始化，尝试重新初始化 ({retry_count + 1}/{max_retries})")
                init_chrome()
                retry_count += 1
                if not chrome_initialized:
                    time.sleep(2)  # 等待2秒后重试
            
            if not chrome_initialized:
                return jsonify({
                    'success': False,
                    'error': 'Chrome浏览器初始化失败，请稍后重试'
                }), 503  # 使用503表示服务暂时不可用
        
        # 确保浏览器已初始化
        if driver is None:
            return jsonify({
                'success': False,
                'error': 'Chrome浏览器未就绪，请稍后重试'
            }), 503
        
        # 先滚动到页面底部
        if not scroll_to_bottom():
            return jsonify({
                'success': False,
                'error': '滚动到页面底部失败'
            }), 500
        
        # 获取曲谱码的重试机制
        retry_count = 0
        max_retries = 5
        score_codes = []
        
        while retry_count < max_retries:
            try:
                page_text = driver.find_element(By.TAG_NAME, "body").text
                numbers = re.findall(r'\b\d{5,}\b', page_text)
                score_codes = list(set(numbers))  # 去重
                
                if score_codes:
                    print(f"共找到 {len(score_codes)} 个曲谱码")
                    break
                else:
                    print(f"未找到任何曲谱码，尝试重试 ({retry_count + 1}/{max_retries})")
                    retry_count += 1
                    if retry_count < max_retries:
                        time.sleep(1)  # 等待1秒后重试
                        # 重新滚动到底部
                        scroll_to_bottom()
            except Exception as e:
                print(f"获取内容时出现错误: {str(e)}")
                retry_count += 1
                if retry_count < max_retries:
                    time.sleep(1)
                    continue
        
        if not score_codes:
            return jsonify({
                'success': False,
                'error': '多次尝试后仍未找到任何曲谱码'
            }), 404
        
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
        print(f"发生错误: {str(e)}")
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
        pyperclip.copy(f"http://{local_ip}:6605")
        print(f"服务器启动在: http://{local_ip}:6605 (已复制到剪贴板)")
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
                pyperclip.copy(f"http://{local_ip}:{port}")
                print(f"服务器启动在: http://{local_ip}:{port} (已复制到剪贴板)")
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

if __name__ == '__main__':
    # 启动时备份数据库
    backup_database()
    
    print("初始化Chrome异步驱动")
    init_chrome_async()

    # 直接启动服务器（不使用线程）
    start_server()