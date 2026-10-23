from fastapi import APIRouter, Body, UploadFile, File, Form
import httpx
from urllib.parse import urlsplit, urlunsplit

router = APIRouter()


def build_picbed_endpoint(url: str, operation: str) -> str:
    """Accept an Lsky site URL, API root, or profile/upload endpoint."""
    try:
        parts = urlsplit(url.strip())
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ValueError
        if parts.username or parts.password or parts.query or parts.fragment:
            raise ValueError
        # Accessing port also validates malformed port numbers.
        parts.port
    except ValueError:
        raise ValueError("请填写有效的图床站点或 API 根地址，例如 https://7bu.top/api/v1，不要包含查询参数或账号密码") from None

    path = parts.path.rstrip('/')
    if path.endswith(("/api/v1/profile", "/api/v1/upload")):
        path = path.rsplit('/', 1)[0]
    if not path.endswith('/api/v1'):
        path += '/api/v1'
    return urlunsplit((parts.scheme, parts.netloc, f"{path}/{operation}", '', ''))


def picbed_http_error(status_code: int, action: str) -> str:
    if status_code == 404:
        return f"{action}接口不存在（404），请检查图床地址，并确认服务兼容 Lsky Pro API v1"
    if status_code in (401, 403):
        return f"图床身份校验失败（{status_code}），请检查 Token 是否有效以及账户权限"
    return f"{action}失败，图床返回了 {status_code} 错误"


@router.post("/test")
async def test_picbed_connection(payload: dict = Body(...)):
    url = payload.get("url", "").strip().rstrip('/')
    token = payload.get("token", "").strip()

    if not url or not token:
        return {"success": False, "message": "图床 API 地址和 Token 不能为空"}

    try:
        test_endpoint = build_picbed_endpoint(url, 'profile')
    except ValueError as error:
        return {"success": False, "message": str(error)}
    if not token.startswith("Bearer "):
        token = f"Bearer {token}"

    headers = {"Authorization": token, "Accept": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(test_endpoint, headers=headers)
            if response.status_code != 200:
                return {"success": False, "message": picbed_http_error(response.status_code, '校验')}

            data = response.json()
            if data.get("status") is True:
                user_email = data.get("data", {}).get("email", "未知用户")
                return {"success": True, "message": f"连接成功！当前账户: {user_email}"}
            else:
                return {"success": False, "message": f"Token 无效: {data.get('message', '未知错误')}"}
    except Exception as e:
        return {"success": False, "message": f"网络异常: {str(e)}"}


# 👇 【全新追加】：真实的图床图片上传接口
@router.post("/upload")
async def upload_image(
        file: UploadFile = File(...),
        url: str = Form(...),
        token: str = Form(...)
):
    url = url.strip().rstrip('/')
    token = token.strip()

    if not token.startswith("Bearer "):
        token = f"Bearer {token}"

    try:
        upload_endpoint = build_picbed_endpoint(url, 'upload')
    except ValueError as error:
        return {"success": False, "message": str(error)}
    headers = {
        "Authorization": token,
        "Accept": "application/json"
    }

    try:
        content = await file.read()
        # 封装为 httpx 支持的文件上传格式
        files = {'file': (file.filename, content, file.content_type)}

        # 上传图片可能较慢，将超时设置为 30 秒
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(upload_endpoint, headers=headers, files=files)

            if response.status_code != 200:
                return {"success": False, "message": picbed_http_error(response.status_code, '上传')}

            data = response.json()
            # 兼容 Lsky Pro 的返回格式
            if data.get("status") is True:
                img_url = data.get("data", {}).get("links", {}).get("url")
                return {"success": True, "message": "上传成功", "url": img_url}
            else:
                return {"success": False, "message": f"图床拒绝接收: {data.get('message', '未知')}"}
    except httpx.ReadTimeout:
        return {"success": False, "message": "图片上传超时，请检查网络或图片是否过大"}
    except Exception as e:
        return {"success": False, "message": f"服务器异常: {str(e)}"}
