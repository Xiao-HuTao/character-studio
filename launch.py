"""Open or start this copy of Character Studio without installing dependencies."""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT=Path(__file__).resolve().parent

def ready(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=.3) as response:data=json.load(response)
        return data.get('app')=='character-studio' and Path(data.get('root','')).resolve()==ROOT
    except Exception:return False

def main():
    if sys.version_info<(3,10):raise SystemExit('需要 Python 3.10 或更新版本。')
    ports=range(8780,8791)
    for port in ports:
        if ready(port):break
    else:
        for port in ports:
            with socket.socket() as connection:
                if connection.connect_ex(('127.0.0.1',port))==0:continue
            process=subprocess.Popen([sys.executable,str(ROOT/'server.py'),str(port)],cwd=ROOT,
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            for _ in range(50):
                if ready(port):break
                if process.poll() is not None:break
                time.sleep(.1)
            if ready(port):break
        else:raise SystemExit('启动失败，请检查 Python 环境和本机端口 8780–8790。')
    url=f'http://127.0.0.1:{port}/';print(url)
    if '--no-open' not in sys.argv:webbrowser.open(url)

if __name__=='__main__':main()
