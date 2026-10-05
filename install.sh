#!/usr/bin/env bash
# dsh-mook-skill 一键安装：把 Mook 技能装进 DeepSeek Harness 技能根。
#
#   ./install.sh                 # 装到 $DSH_HOME/skills（默认 ~/.dsh/skills）
#   DSH_HOME=/path ./install.sh  # 装到指定 DSH 数据根
#
# 只装技能（主路径）。MCP 服务器是可选增强，见 README「第 3 步」。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/skills/mook"

if [ ! -f "$SRC/SKILL.md" ]; then
  echo "错误：找不到 $SRC/SKILL.md，请在仓库根目录运行本脚本。" >&2
  exit 1
fi

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DEST_ROOT="$DSH_HOME/skills"
DEST="$DEST_ROOT/mook"

mkdir -p "$DEST_ROOT"
rm -rf "$DEST"
cp -r "$SRC" "$DEST"

echo "已安装技能到 $DEST"

# 校验：DSH 只发现技能根直接子目录下的 SKILL.md，层级错了会静默失效。
if [ ! -f "$DEST/SKILL.md" ]; then
  echo "错误：安装后 $DEST/SKILL.md 不存在，技能不会被发现。" >&2
  exit 1
fi

echo
echo "下一步："
echo "  1. 在 Mook 网页端「设置 → 访问密钥」创建密钥"
echo "  2. export MOOK_URL=http://你的mook地址:端口    # 不要尾斜杠"
echo "  3. export MOOK_API_KEY=mk_你的密钥"
echo
echo "技能目录被 DSH 监听，不用重启。可选：装 MCP 服务器见 README 第 3 步。"
