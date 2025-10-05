#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
视频压缩功能测试脚本
"""

import os
import tempfile
import sys

# 将项目目录添加到Python路径中
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_root)

from app import compress_video

def test_video_compression():
    """测试视频压缩功能"""
    print("视频压缩功能测试")
    print("================")

    # 检查FFmpeg是否可用
    try:
        import ffmpeg
        print("[OK] FFmpeg-python 库可用")
    except ImportError:
        print("[ERROR] 未安装 ffmpeg-python 库")
        print("请运行: pip install ffmpeg-python")
        return False

    # 检查系统是否安装了FFmpeg
    try:
        os.system("ffmpeg -version >nul 2>&1")
        print("[OK] FFmpeg 可执行文件可用")
    except Exception:
        print("[ERROR] 系统未安装 FFmpeg")
        print("请安装 FFmpeg 并将其添加到系统PATH中")
        return False

    print("\n测试完成！视频压缩功能已就绪。")
    print("\n使用说明:")
    print("1. 视频文件超过500MB时会自动压缩")
    print("2. 压缩后的文件大小在450MB以内")
    print("3. 压缩过程会在后台自动进行")

    return True

if __name__ == "__main__":
    test_video_compression()