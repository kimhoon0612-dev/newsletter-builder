from flask import Flask, jsonify, request, send_from_directory, send_file
import json, os, uuid, traceback, io, re, email, ipaddress, copy, html as html_mod
from datetime import datetime, timezone
from pathlib import Path
from email import policy
from email.parser import BytesParser
from urllib.parse import urlparse
from templates import get_builtin_templates, get_template

# ── 환경변수 로드 (.env 파일 지원) ─────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024

GEMINI_KEY = os.environ.get('GEMINI_API_KEY', '')
SB_URL     = os.environ.get('SUPABASE_URL', '')
SB_KEY     = os.environ.get('SUPABASE_KEY', '')
ADMIN_KEY  = os.environ.get('ADMIN_API_KEY', '')

from supabase import create_client
sb = create_client(SB_URL, SB_KEY) if SB_URL and SB_KEY else None

ALLOWED = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
BASE_DIR = Path(__file__).parent
TMP_DIR = Path('/tmp') if Path('/tmp').exists() else BASE_DIR

def allowed(f):
    return '.' in f and f.rsplit('.', 1)[1].lower() in ALLOWED

# ── 인증 미들웨어 ──────────────────────────────────────────────────

@app.before_request
def check_auth():
    """API Key 기반 인증. 정적 파일/미리보기/루트는 제외."""
    if not ADMIN_KEY:
        return  # 키 미설정 시 인증 비활성화 (로컬 개발)
    path = request.path
    # 인증 제외 경로
    if path == '/' or path.startswith('/static/') or path.endswith('/preview'):
        return
    if not path.startswith('/api/'):
        return
    key = request.headers.get('X-API-Key') or request.args.get('api_key')
    if key != ADMIN_KEY:
        return jsonify({'error': '인증이 필요합니다. API Key를 확인해주세요.'}), 401

# ── Supabase 헬퍼 ─────────────────────────────────────────────────

def _check_sb():
    if not sb:
        raise RuntimeError('Supabase 연결 정보가 설정되지 않았습니다. 환경변수를 확인해주세요.')

def _parse_secs(d):
    s = d.get('sections', [])
    if isinstance(s, str):
        try:
            s = json.loads(s)
        except (json.JSONDecodeError, TypeError):
            s = []
    d['sections'] = s or []
    return d

def list_nl():
    _check_sb()
    r = sb.table('newsletters').select('*').order('updated_at', desc=True).execute()
    items = []
    for d in (r.data or []):
        _parse_secs(d)
        secs = d['sections']
        thumb = secs[0].get('image_url') if secs else None
        items.append({
            'id': d['id'], 'title': d['title'],
            'status': d.get('status', 'draft'),
            'created_at': d['created_at'], 'updated_at': d['updated_at'],
            'section_count': len(secs), 'thumbnail': thumb
        })
    return items

def get_nl(nid):
    _check_sb()
    r = sb.table('newsletters').select('*').eq('id', nid).maybe_single().execute()
    if r.data:
        _parse_secs(r.data)
    return r.data

def save_nl(data):
    _check_sb()
    d = dict(data)
    # sections는 list 그대로 전달 — Supabase JSONB가 자동 처리
    sb.table('newsletters').upsert(d).execute()

def del_nl(nid):
    _check_sb()
    nl = get_nl(nid)
    if nl:
        for s in nl.get('sections', []):
            if s.get('image_url'):
                fname = s['image_url'].split('/')[-1]
                try:
                    sb.storage.from_('uploads').remove([fname])
                except Exception:
                    pass
    sb.table('newsletters').delete().eq('id', nid).execute()

def upload_img(file_bytes, fname, mime):
    _check_sb()
    sb.storage.from_('uploads').upload(
        fname, file_bytes,
        file_options={'content-type': mime, 'upsert': 'true'}
    )
    return sb.storage.from_('uploads').get_public_url(fname)

def resize_image(img_bytes, max_width=650):
    """이미지를 최대 너비 650px로 리사이즈. Pillow가 없으면 원본 반환."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(img_bytes))
        original_fmt = img.format or 'PNG'  # resize 전에 포맷 저장
        if img.width > max_width:
            ratio = max_width / img.width
            new_h = int(img.height * ratio)
            img = img.resize((max_width, new_h), Image.LANCZOS)
        buf = io.BytesIO()
        if original_fmt.upper() in ('JPEG', 'JPG'):
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')
            img.save(buf, 'JPEG', quality=85, optimize=True)
        else:
            img.save(buf, original_fmt, optimize=True)
        return buf.getvalue()
    except Exception:
        return img_bytes

# ── SSRF 방지 헬퍼 ────────────────────────────────────────────────

def _is_safe_url(url):
    """URL이 외부 HTTP(S)인지 검증. 내부 IP 차단."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        # 내부 IP 차단
        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_private or ip.is_loopback or ip.is_reserved:
                return False
        except ValueError:
            # hostname이 IP가 아닌 경우 (도메인)
            blocked = ('localhost', '127.0.0.1', '0.0.0.0', '169.254.')
            if any(hostname.lower().startswith(b) for b in blocked):
                return False
        return True
    except Exception:
        return False

# ── API 라우트 ─────────────────────────────────────────────────────

@app.errorhandler(Exception)
def handle_error(e):
    """글로벌 에러 핸들러 — JSON 형태로 에러 응답 반환"""
    code = getattr(e, 'code', 500)
    if not isinstance(code, int):
        code = 500
    return jsonify({'error': str(e), 'type': type(e).__name__}), code

@app.route('/api/newsletters')
def api_list():
    return jsonify(list_nl())

@app.route('/api/newsletters', methods=['POST'])
def api_create():
    body = request.get_json(force=True, silent=True) or {}
    nid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    nl = {
        'id': nid, 'title': body.get('title', '새 뉴스레터'),
        'status': 'draft', 'sections': [],
        'created_at': now, 'updated_at': now
    }
    save_nl(nl)
    return jsonify(nl), 201

@app.route('/api/newsletters/<nid>', methods=['GET', 'PUT', 'DELETE'])
def api_nl(nid):
    nl = get_nl(nid)
    if not nl:
        return jsonify({'error': 'Not found'}), 404
    if request.method == 'GET':
        return jsonify(nl)
    elif request.method == 'PUT':
        data = request.get_json(force=True, silent=True) or {}
        nl.update({
            'title': data.get('title', nl['title']),
            'sections': data.get('sections', nl['sections']),
            'status': data.get('status', nl.get('status', 'draft')),
            'updated_at': datetime.now(timezone.utc).isoformat()
        })
        save_nl(nl)
        return jsonify(nl)
    elif request.method == 'DELETE':
        del_nl(nid)
        return jsonify({'ok': True})

@app.route('/api/newsletters/<nid>/duplicate', methods=['POST'])
def api_dup(nid):
    nl = get_nl(nid)
    if not nl:
        return jsonify({'error': 'Not found'}), 404
    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    new_secs = []
    for s in nl.get('sections', []):
        old_url = s.get('image_url', '')
        if old_url:
            old_fname = old_url.split('/')[-1]
            ext = old_fname.rsplit('.', 1)[-1]
            new_fname = f"copy_{uuid.uuid4().hex[:8]}.{ext}"
            try:
                file_bytes = sb.storage.from_('uploads').download(old_fname)
                new_url = upload_img(file_bytes, new_fname, f'image/{ext}')
                new_secs.append({**s, 'image_url': new_url})
            except Exception:
                new_secs.append(s)
        else:
            new_secs.append(s)
    new_nl = {
        'id': new_id, 'title': nl['title'] + ' (복사본)',
        'status': 'draft', 'sections': new_secs,
        'created_at': now, 'updated_at': now
    }
    save_nl(new_nl)
    return jsonify(new_nl), 201

@app.route('/api/newsletters/<nid>/status', methods=['PUT'])
def api_status(nid):
    nl = get_nl(nid)
    if not nl:
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    nl['status'] = body.get('status', 'draft')
    nl['updated_at'] = datetime.now(timezone.utc).isoformat()
    save_nl(nl)
    return jsonify(nl)

@app.route('/api/generate-image', methods=['POST'])
def api_gen():
    if not GEMINI_KEY:
        return jsonify({'error': 'GEMINI_API_KEY가 설정되지 않았습니다'}), 500
    body = request.get_json(force=True, silent=True) or {}
    prompt = body.get('prompt', '').strip()
    if not prompt:
        return jsonify({'error': '프롬프트를 입력해주세요'}), 400
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=GEMINI_KEY)
        full = (f"Professional academic medical conference newsletter banner image. "
                f"{prompt}. Clean modern design, high quality, 650px wide newsletter format.")
        resp = client.models.generate_content(
            model="gemini-2.0-flash-preview-image-generation",
            contents=full,
            config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]))
        img_bytes = None
        for part in resp.candidates[0].content.parts:
            if part.inline_data is not None:
                img_bytes = part.inline_data.data
                break
        if not img_bytes:
            return jsonify({'error': '이미지 생성 실패'}), 500
        img_bytes = resize_image(img_bytes, 650)
        fname = f"ai_{uuid.uuid4().hex[:8]}.png"
        url = upload_img(img_bytes, fname, 'image/png')
        return jsonify({'image_url': url, 'url': url})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload-image', methods=['POST'])
def api_upload():
    if 'file' not in request.files:
        return jsonify({'error': '파일 없음'}), 400
    file = request.files['file']
    if not file.filename or not allowed(file.filename):
        return jsonify({'error': '잘못된 파일'}), 400
    ext = file.filename.rsplit('.', 1)[1].lower()
    fname = f"up_{uuid.uuid4().hex[:8]}.{ext}"
    img_bytes = resize_image(file.read(), 650)
    url = upload_img(img_bytes, fname, file.content_type or f'image/{ext}')
    return jsonify({'image_url': url, 'url': url})

# ── EML 파싱 API ──────────────────────────────────────────────────

@app.route('/api/parse-eml', methods=['POST'])
def api_parse_eml():
    """EML 파일을 파싱하여 이미지 블록 + 링크를 추출, 뉴스레터로 자동 생성"""
    if 'file' not in request.files:
        return jsonify({'error': 'EML 파일이 없습니다'}), 400
    file = request.files['file']
    if not file.filename or not file.filename.lower().endswith('.eml'):
        return jsonify({'error': 'EML 파일만 지원합니다'}), 400

    try:
        eml_bytes = file.read()
        msg = BytesParser(policy=policy.default).parsebytes(eml_bytes)

        # 제목 추출 (Re: FW: 등 접두어 제거)
        subject = msg.get('subject', '가져온 뉴스레터')
        subject = re.sub(r'^(RE|FW|FWD|답장|전달)\s*:\s*', '', subject, flags=re.IGNORECASE).strip()

        # HTML 본문 찾기
        html_body = None
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == 'text/html':
                html_body = part.get_content()
                break
        if not html_body:
            return jsonify({'error': 'HTML 본문을 찾을 수 없습니다'}), 400

        # HTML에서 이미지 블록 추출
        sections = []

        def _is_tracking(src, tag_html=''):
            """트래킹 픽셀/작은 이미지 여부 판별"""
            low = src.lower()
            if any(x in low for x in ['spacer', '1x1', 'pixel', 'tracking', 'beacon',
                                       'mail_report_api', 'directsend', 'open-tracking']):
                return True
            if tag_html:
                wh_match = re.findall(r'(?:width|height)\s*=\s*["\']?(\d+)', tag_html, re.IGNORECASE)
                if wh_match and any(int(v) <= 3 for v in wh_match):
                    return True
            return False

        # <a> 안의 <img> 패턴 — Outlook은 <a><span><img></span></a> 구조 사용
        linked_pattern = re.compile(
            r'<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>.*?<img\s[^>]*src=["\']([^"\']+)["\'][^>]*/?\s*>.*?</a>',
            re.IGNORECASE | re.DOTALL
        )
        img_pattern = re.compile(
            r'<img\s[^>]*src=["\']([^"\']+)["\'][^>]*/?\s*>',
            re.IGNORECASE
        )

        found_img_srcs = set()
        for m in linked_pattern.finditer(html_body):
            click_url = m.group(1)
            img_src = m.group(2)
            if img_src in found_img_srcs:
                continue
            if _is_tracking(img_src, m.group(0)):
                found_img_srcs.add(img_src)
                continue
            found_img_srcs.add(img_src)
            alt_match = re.search(r'alt=["\']([^"\']*)["\']', m.group(0), re.IGNORECASE)
            alt_text = alt_match.group(1) if alt_match else ''
            sections.append({
                'original_src': img_src,
                'click_url': click_url,
                'alt_text': alt_text,
                'image_url': ''
            })

        for m in img_pattern.finditer(html_body):
            img_src = m.group(1)
            if img_src in found_img_srcs:
                continue
            if _is_tracking(img_src, m.group(0)):
                found_img_srcs.add(img_src)
                continue
            found_img_srcs.add(img_src)
            alt_match = re.search(r'alt=["\']([^"\']*)["\']', m.group(0), re.IGNORECASE)
            alt_text = alt_match.group(1) if alt_match else ''
            sections.append({
                'original_src': img_src,
                'click_url': '',
                'alt_text': alt_text,
                'image_url': ''
            })

        if not sections:
            return jsonify({'error': '이미지 블록을 찾을 수 없습니다'}), 400

        # 이미지 다운로드 → Supabase 업로드 (SSL 검증 활성화 + SSRF 방지)
        import requests as req_lib
        uploaded_sections = []
        dl_errors = []
        for i, sec in enumerate(sections):
            src = sec['original_src']
            # SSRF 방지: URL 안전성 검증
            if not _is_safe_url(src):
                dl_errors.append(f"[{i}] 차단된 URL: {src[:60]}")
                continue
            try:
                r = req_lib.get(src, timeout=20, verify=True, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                })
                if r.status_code == 200 and len(r.content) > 500:
                    url_path = src.split('?')[0]
                    ext = url_path.rsplit('.', 1)[-1].lower() if '.' in url_path else 'jpg'
                    if ext not in ALLOWED:
                        ext = 'jpg'
                    fname = f"eml_{uuid.uuid4().hex[:8]}.{ext}"
                    img_bytes = resize_image(r.content, 650)
                    url = upload_img(img_bytes, fname, f'image/{ext}')
                    uploaded_sections.append({
                        'image_url': url,
                        'click_url': sec['click_url'],
                        'alt_text': sec['alt_text']
                    })
                else:
                    dl_errors.append(f"[{i}] HTTP {r.status_code}, size={len(r.content)}")
            except Exception as e:
                dl_errors.append(f"[{i}] {type(e).__name__}: {str(e)[:80]}")

        if not uploaded_sections:
            detail = '; '.join(dl_errors[:3]) if dl_errors else '알 수 없는 오류'
            return jsonify({'error': f'이미지 다운로드에 실패했습니다 ({detail})'}), 400

        nid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        nl = {
            'id': nid, 'title': subject,
            'status': 'draft', 'sections': uploaded_sections,
            'created_at': now, 'updated_at': now
        }
        save_nl(nl)
        return jsonify(nl), 201

    except Exception as e:
        return jsonify({'error': f'EML 파싱 오류: {str(e)}'}), 500

# ── 템플릿 API ────────────────────────────────────────────────────

@app.route('/api/templates')
def api_templates():
    """내장 템플릿 목록 반환"""
    return jsonify(get_builtin_templates())

@app.route('/api/templates/<tid>/create', methods=['POST'])
def api_create_from_template(tid):
    """내장 템플릿에서 뉴스레터 생성"""
    tpl = get_template(tid)
    if not tpl:
        return jsonify({'error': '템플릿을 찾을 수 없습니다'}), 404
    nid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    nl = {
        'id': nid,
        'title': tpl['name'],
        'status': 'draft',
        'sections': copy.deepcopy(tpl['sections']),
        'created_at': now,
        'updated_at': now
    }
    save_nl(nl)
    return jsonify(nl), 201

# ── Export / Preview ──────────────────────────────────────────────

@app.route('/api/newsletters/<nid>/export')
def api_export(nid):
    nl = get_nl(nid)
    if not nl:
        return jsonify({'error': 'Not found'}), 404
    html = build_html(nl)
    out = TMP_DIR / f"export_{nid[:6]}.html"
    out.write_text(html, 'utf-8')
    return send_file(str(out), as_attachment=True,
                     download_name=f"newsletter_{nid[:6]}.html", mimetype='text/html')

@app.route('/api/newsletters/<nid>/preview')
def api_preview(nid):
    nl = get_nl(nid)
    if not nl:
        return "Not found", 404
    return build_html(nl), 200, {'Content-Type': 'text/html; charset=utf-8'}

def build_html(nl):
    """이메일 클라이언트 호환 테이블 기반 HTML 생성"""
    rows = []
    for s in nl.get('sections', []):
        img_url = html_mod.escape(s.get('image_url', ''), quote=True)
        url = html_mod.escape(s.get('click_url', '').strip(), quote=True)
        alt = html_mod.escape(s.get('alt_text', 'Newsletter Image'), quote=True)
        img_tag = (f'<img src="{img_url}" alt="{alt}" '
                   f'style="display:block;width:100%;max-width:650px;height:auto;border:0;outline:none" '
                   f'width="650">')
        if url:
            cell = f'<a href="{url}" target="_blank" style="display:block;text-decoration:none">{img_tag}</a>'
        else:
            cell = img_tag
        rows.append(f'''      <tr>
        <td align="center" valign="top" style="padding:0;margin:0;line-height:0;font-size:0">
          {cell}
        </td>
      </tr>''')

    body = '\n'.join(rows)
    return f'''<!DOCTYPE html>
<html lang="ko" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>{nl['title']}</title>
<!--[if mso]>
<style>table,td {{font-family:Arial,sans-serif;}}</style>
<![endif]-->
<style>
  body {{ margin:0; padding:0; background-color:#f4f4f4; font-family:Arial,Helvetica,sans-serif; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }}
  table {{ border-spacing:0; border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }}
  img {{ -ms-interpolation-mode:bicubic; border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }}
  a {{ text-decoration:none; }}
  .email-wrapper {{ width:100%; background-color:#f4f4f4; }}
  .email-container {{ max-width:650px; margin:0 auto; background-color:#ffffff; }}
  .footer-text {{ padding:14px 20px; font-size:11px; line-height:1.5; color:#999999; }}
  .footer-text a {{ color:#666666; text-decoration:underline; }}
  @media only screen and (max-width:680px) {{
    .email-container {{ width:100% !important; }}
    .email-container img {{ width:100% !important; max-width:100% !important; height:auto !important; }}
  }}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4">
<center>
<table role="presentation" class="email-wrapper" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:#f4f4f4;padding:20px 0">
  <tr>
    <td align="center" valign="top">
      <!--[if (gte mso 9)|(IE)]>
      <table align="center" border="0" cellspacing="0" cellpadding="0" width="650"><tr><td align="center" valign="top" width="650">
      <![endif]-->
      <table role="presentation" class="email-container" width="650" cellpadding="0" cellspacing="0" border="0"
             style="max-width:650px;margin:0 auto;background-color:#ffffff">
{body}
        <tr>
          <td class="footer-text" style="padding:14px 20px;border-top:1px solid #E1E1E1;font-size:11px;line-height:1.5;color:#999999">
            본 메일은 수신동의를 하신 회원님께 발송되었습니다.<br>
            수신거부를 원하시면 회신 바랍니다.
          </td>
        </tr>
      </table>
      <!--[if (gte mso 9)|(IE)]>
      </td></tr></table>
      <![endif]-->
    </td>
  </tr>
</table>
</center>
</body>
</html>'''

@app.route('/')
def index():
    return (BASE_DIR / 'admin.html').read_text('utf-8')

if __name__ == '__main__':
    print("Newsletter Builder: http://localhost:5000")
    app.run(debug=True, port=5000)
