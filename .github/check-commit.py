#!/usr/bin/env python3
"""只检查提交说明；作者元数据保持用户的正常 Git 配置。"""
import pathlib
import re
import sys


def fail(reason):
    print(reason, file=sys.stderr)
    raise SystemExit(1)


path = pathlib.Path(sys.argv[1])
message = path.read_text()
# 有些本地集成会追加署名 trailer, 提交前统一移除，不把它写入提交对象, 确保工具隐私
signature = re.compile(r"(?i)^\s*(co-authored-by|signed-off-by|authored-by|generated-by|author|committer|agent|model)\s*:")
lines = [line for line in message.splitlines() if not signature.match(line)]
cleaned = "\n".join(lines).rstrip() + "\n"
if cleaned != message:
    path.write_text(cleaned)
message = cleaned
if re.search(r"[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}", message):
    fail("提交说明不可包含邮箱。")
if re.search(r"(?im)^\s*(co-authored-by|signed-off-by|authored-by|generated-by|author|committer|agent|model)\s*:", message):
    fail("提交说明不可包含任何署名或身份标识。")
if re.search(r"(?i)generated\s+(with|by)|🤖", message):
    fail("提交说明不可包含生成工具署名。")
