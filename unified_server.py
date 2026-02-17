import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'web'))

from flask import Blueprint, send_from_directory, jsonify, Response, make_response

from app import app

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR = os.path.join(BASE_DIR, 'docs')
RV32_DIR = os.path.join(BASE_DIR, 'riscv_cap')
TEST_DIR = os.path.join(BASE_DIR, 'test_harness')

rv32_bp = Blueprint('rv32', __name__, url_prefix='/rv32')

@rv32_bp.route('/')
def rv32_index():
    resp = make_response(send_from_directory(RV32_DIR, 'index.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@rv32_bp.route('/api/docs')
def rv32_list_docs():
    files = []
    if os.path.isdir(DOCS_DIR):
        for f in sorted(os.listdir(DOCS_DIR)):
            if f.endswith('.md'):
                path = os.path.join(DOCS_DIR, f)
                files.append({
                    'name': f,
                    'size': os.path.getsize(path),
                    'title': f.replace('.md', '').replace('-', ' ').title()
                })
    return jsonify(files)

@rv32_bp.route('/api/docs/<path:filename>')
def rv32_get_doc(filename):
    if not filename.endswith('.md'):
        filename += '.md'
    safe_name = os.path.basename(filename)
    filepath = os.path.join(DOCS_DIR, safe_name)
    if os.path.isfile(filepath):
        with open(filepath, 'r') as f:
            content = f.read()
        return Response(content, mimetype='text/plain')
    return Response('Not found', status=404)

@rv32_bp.route('/<path:path>')
def rv32_static(path):
    resp = make_response(send_from_directory(RV32_DIR, path))
    if path.endswith(('.js', '.css', '.html')):
        resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

app.register_blueprint(rv32_bp)

@app.route('/test/')
def test_harness():
    resp = make_response(send_from_directory(TEST_DIR, 'index.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/test/<path:path>')
def test_static(path):
    resp = make_response(send_from_directory(TEST_DIR, path))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

FIGURES_DIR = os.path.join(BASE_DIR, 'docs', 'figures')

@app.route('/figures/')
def figures_index():
    resp = make_response(send_from_directory(FIGURES_DIR, 'lambda-flow-diagram.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/figures/stack-frames')
def figures_stack_frames():
    resp = make_response(send_from_directory(FIGURES_DIR, 'stack-frames-diagram.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/figures/lambda-nesting-sequence')
def figures_lambda_nesting():
    resp = make_response(send_from_directory(FIGURES_DIR, 'lambda-nesting-sequence.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/figures/lambda-calculus-mapping')
def figures_lambda_calculus_mapping():
    resp = make_response(send_from_directory(FIGURES_DIR, 'lambda-calculus-mapping.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/figures/lambda-clamp-example')
def figures_lambda_clamp():
    resp = make_response(send_from_directory(FIGURES_DIR, 'lambda-clamp-example.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/figures/tunnel-architecture')
def figures_tunnel_architecture():
    resp = make_response(send_from_directory(FIGURES_DIR, 'tunnel-architecture.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/figures/dispatch-styles-comparison')
def figures_dispatch_styles():
    resp = make_response(send_from_directory(FIGURES_DIR, 'dispatch-styles-comparison.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/figures/conventional-vs-ctmm')
def figures_conventional_vs_ctmm():
    resp = make_response(send_from_directory(FIGURES_DIR, 'conventional-vs-ctmm.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/figures/boot-sequence-state-machine')
def figures_boot_sequence():
    resp = make_response(send_from_directory(FIGURES_DIR, 'boot-sequence-state-machine.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/figures/mload-validation-pipeline')
def figures_mload_pipeline():
    resp = make_response(send_from_directory(FIGURES_DIR, 'mload-validation-pipeline.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/figures/mint-abstraction-nesting')
def figures_mint_nesting():
    resp = make_response(send_from_directory(FIGURES_DIR, 'mint-abstraction-nesting.html'))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/figures/<path:path>')
def figures_static(path):
    resp = make_response(send_from_directory(FIGURES_DIR, path))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/docs/<path:filename>')
def serve_doc(filename):
    safe_name = os.path.basename(filename)
    filepath = os.path.join(DOCS_DIR, safe_name)
    if os.path.isfile(filepath):
        resp = make_response(open(filepath, 'r').read())
        resp.headers['Content-Type'] = 'text/plain; charset=utf-8'
        resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return resp
    return Response('Not found', status=404)

@app.route('/')
def landing_page():
    return send_from_directory(BASE_DIR, 'landing.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
