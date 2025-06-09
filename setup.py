import PyInstaller.__main__
import os

# 获取当前目录
current_dir = os.path.dirname(os.path.abspath(__file__))

# 构建 PyInstaller 参数
pyinstaller_args = [
    'app.py',  # 主程序文件
    '--name=千音雅集',  # 生成的exe名称
    '--onefile',  # 打包成单个exe文件
    '--add-data=templates;templates',  # 添加templates文件夹
    '--add-data=static;static',  # 添加static文件夹
    '--clean',  # 清理临时文件
    '--noconfirm',  # 不询问确认
    '--hidden-import=engineio.async_drivers.threading',  # 添加隐藏导入
    '--hidden-import=eventlet.hubs.epolls',
    '--hidden-import=eventlet.hubs.kqueue',
    '--hidden-import=eventlet.hubs.selects',
    '--hidden-import=eventlet.hubs.poll',
]

# 运行 PyInstaller
PyInstaller.__main__.run(pyinstaller_args) 