from fastapi import APIRouter, Body
import os
import threading
from typing import Dict, Any

from cms_core.site_config import parse_site_config, replace_config_fields, atomic_write_config

router = APIRouter()
CURRENT_API_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_API_DIR, "..", ".."))
_config_lock = threading.Lock()

# Only these existing root properties may be changed by the settings form.
VALID_ROOT_KEYS = {
    "title", "authorName", "bio", "avatarUrl", "useGradient", "themeColors",
    "bgImages", "defaultPostCover", "photoWallImage", "cloudMusicIds", "social",
    "counts", "chatterTitle", "chatterDescription", "picBedName", "picBedUrl",
    "picBedToken", "danmakuList", "gitalkConfig", "buildDate", "footerBadges",
    "icpConfig", "geminiConfig", "faviconUrl", "navTitle", "navSuffix", "navAfter",
    "friendLinkApplyFormat", "enableLevelSystem",
}


def get_config_path():
    possible_paths = [
        os.path.join(PROJECT_ROOT, "siteConfig.ts"),
        os.path.join(PROJECT_ROOT, "src", "siteConfig.ts"),
        os.path.join(os.path.dirname(CURRENT_API_DIR), "siteConfig.ts"),
    ]
    return next((path for path in possible_paths if os.path.exists(path)), None)


@router.get("/get")
def get_site_config():
    config_path = get_config_path()
    if not config_path:
        return {"success": False, "message": "未能找到 siteConfig.ts 文件"}
    try:
        with open(config_path, "r", encoding="utf-8", newline="") as source:
            parsed_config, _ = parse_site_config(source.read())
        gitalk = parsed_config.get("gitalkConfig")
        if isinstance(gitalk, dict):
            parsed_config["gitalkConfig"] = {**gitalk, "clientSecret": ""}
        return {"success": True, "data": parsed_config}
    except Exception as error:
        return {"success": False, "message": f"解析失败: {error}"}


@router.post("/update")
def update_site_config(payload: Dict[str, Any] = Body(...)):
    updates = payload.get("updates", {})
    if not updates:
        return {"success": False, "message": "没有收到需要更新的数据"}
    if not isinstance(updates, dict):
        return {"success": False, "message": "更新数据必须是对象"}
    config_path = get_config_path()
    if not config_path:
        return {"success": False, "message": "未能扫描到 siteConfig.ts"}
    try:
        # Preserve the legacy form's single-admin shorthand without editing input.
        updates = dict(updates)
        gitalk = updates.get("gitalkConfig")
        if isinstance(gitalk, dict):
            if gitalk.get("clientSecret"):
                return {"success": False, "message": "请在评论设置中使用“保存密钥到本机”，密钥不能写入公开配置"}
            gitalk = {**gitalk, "clientSecret": ""}
            if isinstance(gitalk.get("admin"), str):
                gitalk["admin"] = [gitalk["admin"]]
            updates["gitalkConfig"] = gitalk
        with _config_lock:
            with open(config_path, "r", encoding="utf-8", newline="") as source:
                content = source.read()
            revised = replace_config_fields(content, updates, VALID_ROOT_KEYS)
            if revised != content:
                atomic_write_config(config_path, revised)
        return {"success": True, "message": "本地 siteConfig.ts 修改成功！"}
    except Exception as error:
        return {"success": False, "message": f"文件读写错误: {error}"}
