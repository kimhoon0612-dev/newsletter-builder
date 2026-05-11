from flask import Flask, jsonify, request, send_from_directory, send_file
import json, os, uuid
from datetime import datetime
from pathlib import Path

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024

GEMINI_KEY = os.environ.get('GEMINI_API_KEY', 'AIzaSyAJxvYVp9olr6X0H1kWNJ8z6SSV9LmaCJk')
SB_URL     = os.environ.get('SUPABASE_URL',  'https://cyosqhcrewiehyhhjuod.supabase.co')
SB_KEY     = os.environ.get('SUPABASE_KEY',  'sb_publishable_4vVWh50J4lOtSZ4API3Dmg_IMqtDKxH')

from supabase import create_client
sb = create_client(SB_URL, SB_KEY)

ALLOWED = {'png','jpg','jpeg','gif','webp'}
def allowed(f): return '.' in f and f.rsplit('.',1)[1].lower() in ALLOWED

BASE_DIR = Path(__file__).parent
# Vercel 서버리스 환경에서는 /tmp만 쓰기 가능
TMP_DIR = Path('/tmp') if Path('/tmp').exists() else BASE_DIR

# ── Supabase helpers ───────────────────────────────────────────────

def _parse_secs(d):
    s = d.get('sections', [])
    if isinstance(s, str):
        try: s = json.loads(s)
        except: s = []
    d['sections'] = s or []
    return d

def list_nl():
    r = sb.table('newsletters').select('*').order('updated_at', desc=True).execute()
    items = []
    for d in (r.data or []):
        _parse_secs(d)
        secs = d['sections']
        thumb = secs[0].get('image_url') if secs else None
        items.append({'id':d['id'],'title':d['title'],'status':d.get('status','draft'),
                      'created_at':d['created_at'],'updated_at':d['updated_at'],
                      'section_count':len(secs),'thumbnail':thumb})
    return items

def get_nl(nid):
    r = sb.table('newsletters').select('*').eq('id', nid).maybe_single().execute()
    if r.data: _parse_secs(r.data)
    return r.data

def save_nl(data):
    d = dict(data)
    # Supabase는 JSONB 컬럼에 Python list/dict를 직렬화해서 저장
    if isinstance(d.get('sections'), list):
        d['sections'] = json.dumps(d['sections'], ensure_ascii=False)
    sb.table('newsletters').upsert(d).execute()

def del_nl(nid):
    nl = get_nl(nid)
    if nl:
        for s in nl.get('sections', []):
            if s.get('image_url'):
                fname = s['image_url'].split('/')[-1]
                try: sb.storage.from_('uploads').remove([fname])
                except: pass
    sb.table('newsletters').delete().eq('id', nid).execute()

def upload_img(file_bytes, fname, mime):
    try: sb.storage.from_('uploads').remove([fname])
    except: pass
    sb.storage.from_('uploads').upload(fname, file_bytes, file_options={'content-type': mime, 'upsert': 'true'})
    return sb.storage.from_('uploads').get_public_url(fname)

# ── API ────────────────────────────────────────────────────────────

@app.route('/api/newsletters')
def api_list():
    return jsonify(list_nl())

@app.route('/api/newsletters', methods=['POST'])
def api_create():
    body = request.get_json(force=True, silent=True) or {}
    nid = str(uuid.uuid4()); now = datetime.utcnow().isoformat()
    nl = {'id':nid,'title':body.get('title','새 뉴스레터'),
          'status':'draft','sections':[],'created_at':now,'updated_at':now}
    save_nl(nl); return jsonify(nl), 201

@app.route('/api/newsletters/<nid>', methods=['GET','PUT','DELETE'])
def api_nl(nid):
    nl = get_nl(nid)
    if not nl: return jsonify({'error':'Not found'}), 404
    if request.method == 'GET':
        return jsonify(nl)
    elif request.method == 'PUT':
        data = request.get_json(force=True, silent=True) or {}
        nl.update({'title':data.get('title',nl['title']),
                   'sections':data.get('sections',nl['sections']),
                   'status':data.get('status',nl.get('status','draft')),
                   'updated_at':datetime.utcnow().isoformat()})
        save_nl(nl); return jsonify(nl)
    elif request.method == 'DELETE':
        del_nl(nid); return jsonify({'ok':True})

@app.route('/api/newsletters/<nid>/duplicate', methods=['POST'])
def api_dup(nid):
    nl = get_nl(nid)
    if not nl: return jsonify({'error':'Not found'}), 404
    new_id = str(uuid.uuid4()); now = datetime.utcnow().isoformat()
    new_secs = []
    for s in nl.get('sections', []):
        old_url = s.get('image_url','')
        if old_url:
            old_fname = old_url.split('/')[-1]
            ext = old_fname.rsplit('.',1)[-1]
            new_fname = f"copy_{uuid.uuid4().hex[:8]}.{ext}"
            try:
                file_bytes = sb.storage.from_('uploads').download(old_fname)
                new_url = upload_img(file_bytes, new_fname, f'image/{ext}')
                new_secs.append({**s, 'image_url': new_url})
            except:
                new_secs.append(s)
        else:
            new_secs.append(s)
    new_nl = {'id':new_id,'title':nl['title']+' (복사본)',
              'status':'draft','sections':new_secs,
              'created_at':now,'updated_at':now}
    save_nl(new_nl); return jsonify(new_nl), 201

@app.route('/api/newsletters/<nid>/status', methods=['PUT'])
def api_status(nid):
    nl = get_nl(nid)
    if not nl: return jsonify({'error':'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    nl['status'] = body.get('status','draft')
    nl['updated_at'] = datetime.utcnow().isoformat()
    save_nl(nl); return jsonify(nl)

@app.route('/api/generate-image', methods=['POST'])
def api_gen():
    body = request.get_json(force=True, silent=True) or {}
    prompt = body.get('prompt','').strip()
    if not prompt: return jsonify({'error':'프롬프트를 입력해주세요'}), 400
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=GEMINI_KEY)
        full = (f"Professional academic medical conference newsletter banner image. "
                f"{prompt}. Clean modern design, high quality, 650px wide newsletter format.")
        resp = client.models.generate_content(
            model="gemini-2.0-flash-preview-image-generation",
            contents=full,
            config=types.GenerateContentConfig(response_modalities=["IMAGE","TEXT"]))
        img_bytes = None
        for part in resp.candidates[0].content.parts:
            if part.inline_data is not None:
                img_bytes = part.inline_data.data; break
        if not img_bytes: return jsonify({'error':'이미지 생성 실패'}), 500
        fname = f"ai_{uuid.uuid4().hex[:8]}.png"
        url = upload_img(img_bytes, fname, 'image/png')
        return jsonify({'image_url': url, 'url': url})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload-image', methods=['POST'])
def api_upload():
    if 'file' not in request.files: return jsonify({'error':'파일 없음'}), 400
    file = request.files['file']
    if not file.filename or not allowed(file.filename): return jsonify({'error':'잘못된 파일'}), 400
    ext = file.filename.rsplit('.',1)[1].lower()
    fname = f"up_{uuid.uuid4().hex[:8]}.{ext}"
    url = upload_img(file.read(), fname, file.content_type or f'image/{ext}')
    return jsonify({'image_url': url, 'url': url})

@app.route('/api/newsletters/<nid>/export')
def api_export(nid):
    nl = get_nl(nid)
    if not nl: return jsonify({'error':'Not found'}), 404
    html = build_html(nl)
    # Vercel 서버리스 환경에서는 /tmp에만 쓰기 가능
    out = TMP_DIR / f"export_{nid[:6]}.html"
    out.write_text(html, 'utf-8')
    return send_file(str(out), as_attachment=True,
                     download_name=f"newsletter_{nid[:6]}.html", mimetype='text/html')

@app.route('/api/newsletters/<nid>/preview')
def api_preview(nid):
    nl = get_nl(nid)
    if not nl: return "Not found", 404
    return build_html(nl), 200, {'Content-Type':'text/html; charset=utf-8'}

def build_html(nl):
    parts = []
    for s in nl.get('sections', []):
        img_url = s.get('image_url','')
        url = s.get('click_url','').strip()
        alt = s.get('alt_text','Newsletter Image')
        img = f'<img src="{img_url}" alt="{alt}" style="display:block;width:100%;border:0">'
        parts.append(f'<a href="{url}" target="_blank" style="display:block">{img}</a>' if url else img)
    body = '\n'.join(parts)
    return f"""<!DOCTYPE html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{nl['title']}</title>
<style>body{{margin:0;padding:20px 0;background:#f4f4f4;font-family:Arial}}
.wrap{{max-width:650px;margin:0 auto;background:#fff}}
.foot{{padding:14px;border-top:1px solid #e1e1e1;font-size:11px;color:#999}}</style>
</head><body><div class="wrap">{body}
<div class="foot">본 메일은 수신동의를 하신 회원님께 발송되었습니다.</div>
</div></body></html>"""

@app.route('/')
def index():
    return (BASE_DIR / 'admin.html').read_text('utf-8')

if __name__ == '__main__':
    print("Newsletter Builder: http://localhost:5000")
    app.run(debug=True, port=5000)
