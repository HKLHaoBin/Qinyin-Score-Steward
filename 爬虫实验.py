import time
import json
import csv
import requests
from typing import List, Dict

BASE_URL = "https://act-hk4e-api.miyoushe.com/event/musicugc/v1/second_page"

BASE_PARAMS = {
    "key": "Button_Jianshang",
    "is_from_button": "true",
    "page": 1,
    "page_size": 30,
    "lang": "zh-cn",
    "game_biz": "hk4e_cn",
    "is_mobile": "false",
}

# 把你抓包里的 Cookie 原样贴进来；如果不需要就留空
COOKIE = (
    "mi18nLang=zh-cn; "
    "_MHYUUID=2903d6c6-de16-4f7b-b56f-6b78a2c4bc43; "
    "DEVICEFP_SEED_ID=4f0ea30a34259807; "
    "DEVICEFP_SEED_TIME=1756749599682; "
    "DEVICEFP=38d810118c4f3; "
    "SERVERID=f815eaf6a4679837f990ebc085032436|1756749605|1756749590"
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://act.miyoushe.com",
    "Referer": "https://act.miyoushe.com/ys/event/ugc-music-stable/index.html?mhy_presentation_style=fullscreen&mhy_auth_required=true&game_biz=hk4e_cn",
    "Cookie": COOKIE,  # 如不需要可注释
}

USE_PROXY = False
PROXIES = {"http": "http://127.0.0.1:7897", "https": "http://127.0.0.1:7897"}

def fetch_page(session: requests.Session, page: int, timeout=12) -> dict:
    params = dict(BASE_PARAMS, page=page)
    resp = session.get(
        BASE_URL,
        params=params,
        headers=HEADERS,
        timeout=timeout,
        proxies=PROXIES if USE_PROXY else None,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("retcode") != 0:
        raise RuntimeError(f"retcode={data.get('retcode')} message={data.get('message')}")
    return data

def extract_items(payload: dict) -> List[Dict]:
    """
    正确路径：data.slide.work_list
    做个兜底：万一结构变化，尝试常见备选路径
    """
    d = payload.get("data") or {}
    slide = d.get("slide") or {}
    wl = slide.get("work_list")
    if isinstance(wl, list):
        return wl
    # 兜底（不太可能用到）
    for path in (("data", "list"), ("list",), ("data", "records"), ("data", "posts")):
        cur = payload
        ok = True
        for k in path:
            cur = cur.get(k, {})
            if not isinstance(cur, (dict, list)):
                ok = False
                break
        if ok and isinstance(cur, list):
            return cur
    return []

def crawl_all(max_pages=200, sleep_sec=0.25):
    session = requests.Session()
    page = int(BASE_PARAMS["page"])
    page_size = int(BASE_PARAMS["page_size"])
    all_items: List[Dict] = []
    seen = set()

    for _ in range(max_pages):
        payload = fetch_page(session, page)
        items = extract_items(payload)
        print(f"page={page} -> {len(items)} items")

        for it in items:
            uid = it.get("work_id") or it.get("id") or it.get("bbs_post_id") or json.dumps(it, sort_keys=True)
            if uid in seen:
                continue
            seen.add(uid)
            all_items.append(it)

        if len(items) < page_size:
            break
        page += 1
        time.sleep(sleep_sec)  # 轻微限速，防 429/风控
    return all_items

def project_fields(items: List[Dict]) -> List[Dict]:
    """
    把常用字段挑出来，方便看/导出。
    可按需增删。
    """
    out = []
    for it in items:
        user = it.get("user") or {}
        game = it.get("game_data") or {}
        out.append({
            "work_id": it.get("work_id"),
            "share_code": it.get("share_code"),   # ⭐ 新增：曲谱码
            "title": it.get("title"),
            "desc": it.get("describe"),
            "cover_url": it.get("cover_url"),
            "region": it.get("region"),
            "music_id": it.get("music_id") or game.get("music_id"),
            "note_count": it.get("node_count") or game.get("note_count"),
            "nickname": user.get("nickname"),
            "uid": user.get("uid"),
            "like_cnt": (it.get("interact_data") or {}).get("like_cnt"),
            "save_cnt": (it.get("interact_data") or {}).get("save_cnt"),
            "game_like_cnt": (it.get("interact_data") or {}).get("game_like_cnt"),
            "publish_time": game.get("publish_time"),
            "hot_score": it.get("hot_score"),
            "quality_score": it.get("quality_score"),
            "video_json": it.get("video_media_info"),  # 原始字符串，里面有多清晰度播放地址
        })
    return out

if __name__ == "__main__":
    items = crawl_all(max_pages=200, sleep_sec=0.3)
    print(f"total collected: {len(items)}")

    # 1) 存原始 JSON
    with open("musicugc_all_raw.json", "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print("saved raw -> musicugc_all_raw.json")

    # 2) 抽字段并导出 CSV（可选）
    rows = project_fields(items)
    fieldnames = list(rows[0].keys()) if rows else []
    if rows:
        with open("musicugc_all.csv", "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            w.writerows(rows)
        print("saved csv -> musicugc_all.csv")

    # 3) 预览前几条
    for i, r in enumerate(rows[:5], 1):
        print(f"{i}. {r['title']} | {r['nickname']} | code={r['share_code']} | likes={r['like_cnt']}")
