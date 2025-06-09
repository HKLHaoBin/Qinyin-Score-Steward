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

app = Flask(__name__)
socketio = SocketIO(app, async_mode='threading')

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
    
    while True:
        try:
            current_content = pyperclip.paste()
            if current_content and current_content != last_clipboard_content:
                last_clipboard_content = current_content
                
                # 检查是否是有效的曲谱码
                if is_valid_score_code(current_content):
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
clipboard_thread = threading.Thread(target=check_clipboard, daemon=True)
clipboard_thread.start()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/scores', methods=['GET'])
def get_scores():
    conn = sqlite3.connect('scores.db')
    c = conn.cursor()
    c.execute('''
        SELECT score_code, completion, is_favorite, created_at 
        FROM scores 
        ORDER BY created_at DESC
    ''')
    scores = c.fetchall()
    conn.close()
    return jsonify([{
        'score_code': s[0],
        'completion': s[1],
        'is_favorite': bool(s[2]),
        'created_at': s[3]
    } for s in scores])

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
    return render_template('batch_query.html')

@app.route('/api/scores/batch', methods=['POST'])
def batch_query_scores():
    try:
        data = request.get_json()
        score_codes = data.get('score_codes', [])
        
        if not score_codes:
            return jsonify({'success': False, 'error': '未提供曲谱码'}), 400
            
        # 验证所有曲谱码都是有效的
        if not all(is_valid_score_code(code) for code in score_codes):
            return jsonify({'success': False, 'error': '包含无效的曲谱码'}), 400
            
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
        return jsonify({
            'success': True, 
            'results': results,
            'total': len(score_codes),
            'found': len([r for r in results if r['completion'] is not None])
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    # 启动时备份数据库
    backup_database()
    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)
    pyperclip.copy(f"http://{local_ip}:5005")
    print(f"服务器启动在: http://{local_ip}:5005 (已复制到剪贴板)")
    socketio.run(app, host='0.0.0.0', port=5005, debug=False)