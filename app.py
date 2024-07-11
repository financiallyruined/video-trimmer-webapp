import os
import time
import threading
import logging
from flask import Flask, render_template, request, send_file, Response, jsonify, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import subprocess
import json
import shutil
from datetime import datetime
import glob


app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_secret_key_here'  # Change this to a random secret key
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

VIDEO_FOLDER = r'D:\/'
OUTPUT_FOLDER = 'outputs'
TEMP_FOLDER = 'temp'
ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv'}

app.config['VIDEO_FOLDER'] = VIDEO_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER
app.config['TEMP_FOLDER'] = TEMP_FOLDER

logging.basicConfig(filename='video_trimmer.log', level=logging.DEBUG, 
                    format='%(asctime)s %(levelname)s: %(message)s')

trimming_progress = {}

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Video(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(200), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    date_added = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship('User', backref=db.backref('videos', lazy=True))

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_directory_structure(path):
    directory_structure = []
    for root, dirs, files in os.walk(path):
        rel_path = os.path.relpath(root, path)
        if rel_path == '.':
            rel_path = ''
        directory_structure.append({
            'path': rel_path,
            'type': 'directory',
            'name': os.path.basename(root)
        })
        for file in files:
            if allowed_file(file):
                directory_structure.append({
                    'path': os.path.join(rel_path, file),
                    'type': 'file',
                    'name': file
                })
    return directory_structure

def get_video_duration(filename):
    try:
        result = subprocess.run([
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of',
            'default=noprint_wrappers=1:nokey=1', filename
        ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=True)
        return float(result.stdout)
    except subprocess.CalledProcessError as e:
        logging.error(f"Error getting video duration: {e.output}")
        raise ValueError(f"Could not determine video duration: {e.output}")

def update_progress(job_id, progress):
    trimming_progress[job_id] = max(trimming_progress.get(job_id, 0), progress)
    logging.debug(f"Job {job_id}: Progress updated to {trimming_progress[job_id]}%")

@app.route('/')
@login_required
def index():
    def get_directory_structure(path):
        directory_structure = []
        for root, dirs, files in os.walk(path):
            rel_path = os.path.relpath(root, path)
            if rel_path == '.':
                rel_path = ''
            directory_structure.append({
                'path': rel_path,
                'type': 'directory',
                'name': os.path.basename(root)
            })
            for file in files:
                if allowed_file(file):
                    file_path = os.path.join(root, file)
                    file_size = os.path.getsize(file_path)
                    directory_structure.append({
                        'path': os.path.join(rel_path, file),
                        'type': 'file',
                        'name': file,
                        'size': file_size
                    })
        return directory_structure

    directory_structure = get_directory_structure(app.config['VIDEO_FOLDER'])
    return render_template('index.html', directory_structure=directory_structure)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user)
            return redirect(url_for('index'))
        flash('Invalid username or password')
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if User.query.filter_by(username=username).first():
            flash('Username already exists')
        else:
            new_user = User(username=username)
            new_user.set_password(password)
            db.session.add(new_user)
            db.session.commit()
            flash('Registration successful. Please log in.')
            return redirect(url_for('login'))
    return render_template('register.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/my_videos')
@login_required
def my_videos():
    videos = Video.query.filter_by(user_id=current_user.id).all()
    
    videos_list = []
    for video in videos:
        file_path = os.path.join(app.config['OUTPUT_FOLDER'], video.filename)
        file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
        
        videos_list.append({
            'id': video.id,
            'filename': video.filename,
            'date_added': video.date_added.isoformat(),
            'file_size': file_size
        })
    
    return render_template('my_videos.html', videos=videos, videos_json=videos_list)

@app.route('/list_directory', methods=['POST'])
def list_directory():
    path = request.json.get('path', '')
    full_path = os.path.join(app.config['VIDEO_FOLDER'], path)
    items = []
    for item in os.listdir(full_path):
        item_path = os.path.join(full_path, item)
        if os.path.isdir(item_path):
            items.append({
                'name': item,
                'type': 'directory',
                'path': os.path.join(path, item)
            })
        elif os.path.isfile(item_path) and allowed_file(item):
            items.append({
                'name': item,
                'type': 'file',
                'path': os.path.join(path, item),
                'size': os.path.getsize(item_path)
            })
    return jsonify(items)

@app.route('/video_info/<job_id>')
def video_info(job_id):
    video_path = os.path.join(app.config['OUTPUT_FOLDER'], f'trimmed_{job_id}_*')
    matching_files = glob.glob(video_path)
    if matching_files:
        file_path = matching_files[0]
        file_size = os.path.getsize(file_path)
        return jsonify({'size': file_size})
    else:
        return jsonify({'error': 'Video not found'}), 404

@app.route('/trim', methods=['POST'])
@login_required
def trim():
    video_path = request.form.get('custom_path') or os.path.join(app.config['VIDEO_FOLDER'], request.form.get('file', ''))
    
    if not os.path.exists(video_path):
        return jsonify({"error": 'Video file not found'}), 400
    
    if not allowed_file(video_path):
        return jsonify({"error": 'Invalid file type'}), 400
    
    time_segments = json.loads(request.form.get('time_segments', '[]'))
    
    if not time_segments:
        return jsonify({"error": 'No valid time segments provided'}), 400
    
    job_id = f"{int(time.time())}"
    output_filename = os.path.join(app.config['OUTPUT_FOLDER'], f'trimmed_{job_id}_{os.path.basename(video_path)}')
    
    trimming_progress[job_id] = 0
    threading.Thread(target=trim_and_combine_video, args=(video_path, output_filename, time_segments, job_id, current_user.id)).start()
    
    return jsonify({"job_id": job_id}), 200

def trim_and_combine_video(input_path, output_path, time_segments, job_id, user_id):
    temp_dir = os.path.join(app.config['TEMP_FOLDER'], job_id)
    try:
        os.makedirs(temp_dir, exist_ok=True)
        
        segment_files = []
        total_segments = len(time_segments)
        
        for i, segment in enumerate(time_segments):
            start_time = segment['start_time']
            end_time = segment['end_time']
            segment_file = os.path.join(temp_dir, f"segment_{i}.mp4")
            segment_files.append(segment_file)
            
            ffmpeg_command = [
                'ffmpeg',
                '-i', input_path,
                '-ss', start_time,
                '-to', end_time,
                '-c', 'copy',
                segment_file
            ]
            
            try:
                subprocess.run(ffmpeg_command, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                progress = min(int((i + 1) / total_segments * 90), 90)  
                update_progress(job_id, progress)
            except subprocess.CalledProcessError as e:
                logging.error(f"Error trimming segment {i}: {e.output}")
                raise ValueError(f"Error trimming segment {i}: {e.output}")
        
        concat_file = os.path.join(temp_dir, 'segments.txt')
        with open(concat_file, 'w') as f:
            for segment_file in segment_files:
                f.write(f"file '{os.path.basename(segment_file)}'\n")
        
        combine_command = [
            'ffmpeg',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_file,
            '-c', 'copy',
            output_path
        ]
        
        try:
            update_progress(job_id, 95)  
            subprocess.run(combine_command, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            update_progress(job_id, 100) 
            

            with app.app_context():
                new_video = Video(filename=os.path.basename(output_path), user_id=user_id)
                db.session.add(new_video)
                db.session.commit()
        except subprocess.CalledProcessError as e:
            logging.error(f"Error combining segments: {e.output}")
            raise ValueError(f"Error combining segments: {e.output}")
        
    except Exception as e:
        logging.error(f"An error occurred: {str(e)}")
        trimming_progress[job_id] = -1
        raise
    finally:
        # Clean up temporary files
        shutil.rmtree(temp_dir, ignore_errors=True)

@app.route('/progress/<job_id>')
@login_required
def progress(job_id):
    def generate():
        while True:
            yield f"data: {json.dumps({'progress': trimming_progress.get(job_id, 0)})}\n\n"
            if trimming_progress.get(job_id, 0) == 100 or trimming_progress.get(job_id, 0) == -1:
                break
            time.sleep(1)
    return Response(generate(), mimetype='text/event-stream')

@app.route('/delete_video/<int:video_id>', methods=['POST'])
@login_required
def delete_video(video_id):
    video = Video.query.get_or_404(video_id)
    
    if video.user_id != current_user.id:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    try:
        file_path = os.path.join(app.config['OUTPUT_FOLDER'], video.filename)
        if os.path.exists(file_path):
            os.remove(file_path)

        db.session.delete(video)
        db.session.commit()

        return jsonify({'success': True, 'message': 'Video deleted successfully'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500

# @app.route('/download/<filename>')
# @login_required
# def download(filename):
#     video = Video.query.filter_by(filename=filename, user_id=current_user.id).first()
#     if video:
#         return send_file(os.path.join(app.config['OUTPUT_FOLDER'], filename), as_attachment=True)
#     return "File not found", 404

@app.route('/download/<job_id>')
def download(job_id):
    video_path = os.path.join(app.config['OUTPUT_FOLDER'], f'trimmed_{job_id}_*')
    matching_files = glob.glob(video_path)
    if matching_files:
        return send_file(matching_files[0], as_attachment=True)
    else:
        return "File not found", 404

if __name__ == '__main__':
    if not os.path.isdir(VIDEO_FOLDER):
        print(f"Error: The directory {VIDEO_FOLDER} does not exist.")
        exit(1)
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)
    os.makedirs(TEMP_FOLDER, exist_ok=True)
    with app.app_context():
        db.create_all()
    app.run(debug=True, threaded=True)