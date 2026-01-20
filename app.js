// ==================== GLOBAL STATE ====================
let ffmpeg = null, ffmpegLoaded = false, currentMode = 'converter';
let converterFiles = [], selectedFormat = 'mp4', currentFormatTab = 'video';

// Photo state
let photoCanvas, photoCtx, overlayCanvas, overlayCtx, originalImage = null;
let photoHistory = [], photoHistoryIndex = -1, photoZoomLevel = 100;
let currentPhotoTool = 'select', currentFilter = 'none', isDrawing = false, lastX = 0, lastY = 0;
let photoAdjustments = {brightness:0,contrast:0,saturation:0,exposure:0,temperature:0};
let textLayers = [], selectedTextLayer = null, textIdCounter = 0;
let cropState = {active:false,x:0,y:0,width:0,height:0,dragging:false,handle:null};

// Video state  
let videoFile = null, videoPlayer, videoDuration = 0, trimIn = 0, trimOut = null;

const formats = {video:['mp4','webm','mkv','avi','mov','gif'],audio:['mp3','aac','wav','ogg','flac'],image:['png','jpg','webp','gif']};
const filters = [{id:'none',name:'Original',icon:'🚫'},{id:'grayscale',name:'B&W',icon:'⚫'},{id:'sepia',name:'Sepia',icon:'🟤'},{id:'vintage',name:'Vintage',icon:'📷'},{id:'cold',name:'Cold',icon:'❄️'},{id:'warm',name:'Warm',icon:'☀️'},{id:'vivid',name:'Vivid',icon:'🌈'}];
const qualityCRF = {1:35,2:28,3:23,4:20,5:16};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    photoCanvas = document.getElementById('photoCanvas');
    photoCtx = photoCanvas.getContext('2d', {willReadFrequently: true});
    overlayCanvas = document.getElementById('overlayCanvas');
    overlayCtx = overlayCanvas.getContext('2d');
    videoPlayer = document.getElementById('videoPlayer');
    setupEventListeners();
    renderFormats();
    renderFilters();
    await initFFmpeg();
});

async function initFFmpeg() {
    await window.coiReady;
    if (typeof SharedArrayBuffer === 'undefined') {
        document.getElementById('ffmpegLoading').innerHTML = '<div style="text-align:center;padding:20px;"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><div style="font-size:14px;margin-bottom:8px;">Refresh to initialize</div><button class="btn primary" onclick="location.reload()">Refresh</button></div>';
        document.getElementById('statusText').textContent = 'Setup needed';
        return;
    }
    try {
        const {createFFmpeg, fetchFile} = FFmpeg;
        ffmpeg = createFFmpeg({log: true, corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
            progress: ({ratio}) => {
                const p = Math.round(ratio * 100);
                updateProgress(p);
                const bar = document.getElementById('exportProgressBar');
                const pct = document.getElementById('exportPercent');
                if (bar) bar.style.width = p + '%';
                if (pct) pct.textContent = p + '%';
            }
        });
        window.ffmpegFetchFile = fetchFile;
        await ffmpeg.load();
        ffmpegLoaded = true;
        document.getElementById('ffmpegLoading').style.display = 'none';
        document.getElementById('statusDot').classList.add('ready');
        document.getElementById('statusText').textContent = 'Ready';
    } catch (e) {
        console.error(e);
        document.getElementById('ffmpegLoading').innerHTML = '<div style="color:var(--error);padding:20px;text-align:center;">Failed to load FFmpeg</div>';
    }
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    // Converter
    const dz = document.getElementById('converterDropZone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); handleConverterFiles(e.dataTransfer.files); });
    dz.addEventListener('click', e => { if (!converterFiles.length && e.target === dz) document.getElementById('converterFileInput').click(); });
    document.getElementById('converterFileInput').addEventListener('change', e => handleConverterFiles(e.target.files));

    // Photo
    document.getElementById('photoFileInput').addEventListener('change', e => handlePhotoFile(e.target.files[0]));
    const pc = document.getElementById('photoCanvasContainer');
    pc.addEventListener('dragover', e => e.preventDefault());
    pc.addEventListener('drop', e => { e.preventDefault(); handlePhotoFile(e.dataTransfer.files[0]); });
    
    // Canvas events for drawing
    photoCanvas.addEventListener('mousedown', onCanvasMouseDown);
    photoCanvas.addEventListener('mousemove', onCanvasMouseMove);
    photoCanvas.addEventListener('mouseup', onCanvasMouseUp);
    photoCanvas.addEventListener('mouseleave', onCanvasMouseUp);
    
    // Crop events
    const cropBox = document.getElementById('cropBox');
    cropBox.addEventListener('mousedown', onCropMouseDown);
    document.querySelectorAll('.crop-handle').forEach(h => {
        h.addEventListener('mousedown', e => { e.stopPropagation(); onCropHandleMouseDown(e); });
    });
    document.addEventListener('mousemove', onCropMouseMove);
    document.addEventListener('mouseup', onCropMouseUp);

    // Video
    document.getElementById('videoFileInput').addEventListener('change', e => handleVideoFile(e.target.files[0]));
    const vp = document.getElementById('videoPreview');
    vp.addEventListener('dragover', e => e.preventDefault());
    vp.addEventListener('drop', e => { e.preventDefault(); handleVideoFile(e.dataTransfer.files[0]); });
    videoPlayer.addEventListener('timeupdate', updateVideoTime);
    videoPlayer.addEventListener('loadedmetadata', onVideoLoaded);
    videoPlayer.addEventListener('click', toggleVideoPlay);
    
    // Scrubber
    document.getElementById('videoScrubber').addEventListener('mousedown', onScrubberMouseDown);

    // Keyboard
    document.addEventListener('keydown', handleKeyDown);
}

function handleKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    if (currentMode === 'video' && videoFile) {
        if (e.key === ' ') { e.preventDefault(); toggleVideoPlay(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); videoPlayer.currentTime = Math.min(videoDuration, videoPlayer.currentTime + 1); }
        if (e.key === 'i' || e.key === 'I') setTrimStart();
        if (e.key === 'o' || e.key === 'O') setTrimEnd();
    }
    
    if (currentMode === 'photo') {
        if (e.ctrlKey && e.key === 'z') { e.preventDefault(); photoUndo(); }
        if (e.ctrlKey && e.key === 'y') { e.preventDefault(); photoRedo(); }
        if (e.key === 'v' || e.key === 'V') setPhotoTool('select');
        if (e.key === 'c' || e.key === 'C') setPhotoTool('crop');
        if (e.key === 'b' || e.key === 'B') setPhotoTool('brush');
        if (e.key === 'e' || e.key === 'E') setPhotoTool('eraser');
        if (e.key === 't' || e.key === 'T') setPhotoTool('text');
        if (e.key === 'Delete' && selectedTextLayer) deleteTextLayer(selectedTextLayer);
    }
}

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    document.querySelectorAll('.mode-panel').forEach(p => p.classList.toggle('active', p.id === mode + 'Panel'));
}

// ==================== CONVERTER ====================
function handleConverterFiles(fileList) {
    for (const file of fileList) {
        const type = getFileType(file);
        if (type) {
            const id = Date.now() + Math.random();
            const thumb = (type === 'image' || type === 'video') ? URL.createObjectURL(file) : null;
            converterFiles.push({id, file, name: file.name, size: file.size, type, status: 'pending', progress: 0, thumb, converted: null});
        }
    }
    renderConverterFiles();
}

function getFileType(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (['mp4','webm','mkv','avi','mov','flv','wmv','m4v','3gp','ts'].includes(ext) || file.type.startsWith('video/')) return 'video';
    if (['mp3','wav','ogg','flac','aac','m4a','wma','opus'].includes(ext) || file.type.startsWith('audio/')) return 'audio';
    if (['jpg','jpeg','png','gif','webp','bmp','tiff','ico'].includes(ext) || file.type.startsWith('image/')) return 'image';
    return null;
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function renderConverterFiles() {
    const list = document.getElementById('fileList');
    const wrapper = document.getElementById('converterFileListWrapper');
    const empty = document.getElementById('converterEmpty');
    const dropZone = document.getElementById('converterDropZone');
    
    if (converterFiles.length === 0) {
        wrapper.style.display = 'none';
        empty.style.display = 'block';
        dropZone.classList.remove('has-files');
        document.getElementById('convertAllBtn').disabled = true;
        return;
    }
    
    wrapper.style.display = 'flex';
    empty.style.display = 'none';
    dropZone.classList.add('has-files');
    document.getElementById('fileCount').textContent = converterFiles.length;
    document.getElementById('convertAllBtn').disabled = !ffmpegLoaded;
    
    list.innerHTML = converterFiles.map(f => `
        <div class="file-item ${f.status}">
            <div class="file-thumb">${f.thumb && f.type === 'image' ? `<img src="${f.thumb}">` : (f.thumb && f.type === 'video' ? `<video src="${f.thumb}" muted></video>` : (f.type === 'video' ? '🎬' : (f.type === 'audio' ? '🎵' : '🖼️')))}</div>
            <div class="file-info">
                <div class="file-name">${f.name}</div>
                <div class="file-meta">
                    <span>${formatSize(f.size)}</span>
                    ${f.status === 'done' ? `<span style="color:var(--success)">→ ${formatSize(f.convertedSize)}</span>` : ''}
                    ${f.status === 'converting' ? `<span style="color:var(--accent)">${f.progress}%</span>` : ''}
                </div>
                ${f.status === 'converting' ? `<div class="file-progress"><div class="file-progress-bar" style="width:${f.progress}%"></div></div>` : ''}
            </div>
            <div class="file-actions">
                ${f.status === 'done' ? `<button class="file-action download" onclick="downloadConverted('${f.id}')" title="Download">⬇</button>` : ''}
                <button class="file-action" onclick="removeConverterFile('${f.id}')" title="Remove">✕</button>
            </div>
        </div>
    `).join('');
}

function removeConverterFile(id) { converterFiles = converterFiles.filter(f => f.id != id); renderConverterFiles(); }
function clearAllFiles() { converterFiles = []; renderConverterFiles(); }

function setConvertTool(tool) {
    document.querySelectorAll('.converter-sidebar .tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    if (tool === 'extract') { setFormatTab('audio'); selectFormat('mp3'); }
    else if (tool === 'gif') { setFormatTab('video'); selectFormat('gif'); }
    else if (tool === 'compress') { document.getElementById('qualityPreset').value = '2'; }
}

function setFormatTab(tab) {
    currentFormatTab = tab;
    document.querySelectorAll('.format-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    renderFormats();
}

function renderFormats() {
    document.getElementById('formatGrid').innerHTML = formats[currentFormatTab].map(f => 
        `<button class="format-btn ${f === selectedFormat ? 'selected' : ''}" onclick="selectFormat('${f}')">${f}</button>`
    ).join('');
}

function selectFormat(fmt) { selectedFormat = fmt; renderFormats(); }

function applyPreset(preset) {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    event.target.closest('.preset-btn').classList.add('active');
    const presets = {web:{format:'mp4',quality:'3',resolution:'1280:720'},mobile:{format:'mp4',quality:'2',resolution:'854:480'},hq:{format:'mp4',quality:'5',resolution:''}};
    const p = presets[preset];
    selectFormat(p.format); setFormatTab('video');
    document.getElementById('qualityPreset').value = p.quality;
    document.getElementById('resolution').value = p.resolution;
}

function setSettingsTab(tab) {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.settings-content').forEach(c => c.classList.toggle('active', c.id === 'settings-' + tab));
}

async function convertAll() {
    if (!ffmpegLoaded || converterFiles.length === 0) return;
    document.getElementById('convertAllBtn').disabled = true;
    for (const f of converterFiles) { if (f.status !== 'done') await convertFile(f); }
    document.getElementById('convertAllBtn').disabled = false;
    toast('success', 'All conversions complete!');
}

async function convertFile(fileObj) {
    fileObj.status = 'converting'; fileObj.progress = 0; renderConverterFiles();
    const inputExt = fileObj.name.split('.').pop();
    const inputName = `input.${inputExt}`, outputName = `output.${selectedFormat}`;
    
    try {
        ffmpeg.FS('writeFile', inputName, await window.ffmpegFetchFile(fileObj.file));
        const args = buildFFmpegArgs(inputName, outputName);
        await ffmpeg.run(...args);
        const data = ffmpeg.FS('readFile', outputName);
        const blob = new Blob([data.buffer], {type: getMimeType(selectedFormat)});
        fileObj.converted = URL.createObjectURL(blob);
        fileObj.convertedSize = blob.size;
        fileObj.convertedName = fileObj.name.replace(/\.[^/.]+$/, '') + '.' + selectedFormat;
        fileObj.status = 'done';
        ffmpeg.FS('unlink', inputName); ffmpeg.FS('unlink', outputName);
    } catch (e) {
        console.error(e); fileObj.status = 'error'; toast('error', `Failed: ${fileObj.name}`);
    }
    renderConverterFiles();
}

function buildFFmpegArgs(input, output) {
    const args = [];
    args.push('-i', input);
    
    const isVideo = ['mp4','webm','mkv','avi','mov','gif'].includes(selectedFormat);
    const isAudio = ['mp3','aac','wav','ogg','flac'].includes(selectedFormat);
    
    if (isVideo && selectedFormat !== 'gif') {
        const codec = document.getElementById('videoCodec').value;
        if (codec !== 'copy') {
            args.push('-c:v', codec, '-crf', String(qualityCRF[document.getElementById('qualityPreset').value]));
        } else {
            args.push('-c:v', 'copy');
        }
        
        const vf = [], res = document.getElementById('resolution').value;
        if (res) {
            const [w, h] = res.split(':');
            vf.push(document.getElementById('keepAspect').checked ? 
                `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2` : 
                `scale=${w}:${h}`);
        }
        const fps = document.getElementById('frameRate').value;
        if (fps) vf.push(`fps=${fps}`);
        if (vf.length) args.push('-vf', vf.join(','));
        
        const ac = document.getElementById('audioCodec').value;
        if (ac === 'none') args.push('-an');
        else if (ac !== 'copy') args.push('-c:a', ac, '-b:a', document.getElementById('audioBitrate').value);
        else args.push('-c:a', 'copy');
    } else if (selectedFormat === 'gif') {
        const res = document.getElementById('resolution').value;
        const sc = res ? res.split(':')[0] : '480';
        args.push('-vf', `fps=15,scale=${sc}:-1:flags=lanczos`, '-loop', '0');
    } else if (isAudio) {
        const codec = {mp3:'libmp3lame',aac:'aac',ogg:'libvorbis',flac:'flac',wav:null}[selectedFormat];
        if (codec) args.push('-c:a', codec);
        if (!['flac','wav'].includes(selectedFormat)) args.push('-b:a', document.getElementById('audioBitrate').value);
    }
    
    args.push('-y', output);
    return args;
}

function updateProgress(p) {
    const f = converterFiles.find(f => f.status === 'converting');
    if (f) { f.progress = p; renderConverterFiles(); }
}

function downloadConverted(id) {
    const f = converterFiles.find(f => f.id == id);
    if (f?.converted) {
        const a = document.createElement('a');
        a.href = f.converted; a.download = f.convertedName; a.click();
    }
}

function getMimeType(fmt) {
    const t = {mp4:'video/mp4',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo',mov:'video/quicktime',gif:'image/gif',mp3:'audio/mpeg',aac:'audio/aac',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
    return t[fmt] || 'application/octet-stream';
}

// ==================== PHOTO EDITOR ====================
function handlePhotoFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const img = new Image();
    img.onload = () => {
        originalImage = img;
        photoCanvas.width = img.width; photoCanvas.height = img.height;
        overlayCanvas.width = img.width; overlayCanvas.height = img.height;
        resetAdjustments();
        photoHistory = []; photoHistoryIndex = -1;
        textLayers = []; selectedTextLayer = null;
        document.getElementById('textLayersContainer').innerHTML = '';
        savePhotoState();
        renderPhoto();
        document.getElementById('photoEmpty').style.display = 'none';
        document.getElementById('photoCanvasWrapper').style.display = 'block';
        document.getElementById('photoInfo').textContent = `${img.width} × ${img.height}px`;
        photoZoomFit();
    };
    img.src = URL.createObjectURL(file);
}

function renderPhoto() {
    if (!originalImage) return;
    photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
    photoCtx.drawImage(originalImage, 0, 0, photoCanvas.width, photoCanvas.height);
    
    const imageData = photoCtx.getImageData(0, 0, photoCanvas.width, photoCanvas.height);
    const data = imageData.data;
    const br = photoAdjustments.brightness / 100;
    const ct = (photoAdjustments.contrast + 100) / 100;
    const sat = (photoAdjustments.saturation + 100) / 100;
    const exp = Math.pow(2, photoAdjustments.exposure / 100);
    const temp = photoAdjustments.temperature / 100;
    
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i+1], b = data[i+2];
        r *= exp; g *= exp; b *= exp;
        r += br * 255; g += br * 255; b += br * 255;
        r = ((r/255 - 0.5) * ct + 0.5) * 255;
        g = ((g/255 - 0.5) * ct + 0.5) * 255;
        b = ((b/255 - 0.5) * ct + 0.5) * 255;
        if (temp > 0) { r += temp * 30; b -= temp * 30; } else { r += temp * 30; b -= temp * 30; }
        const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
        r = gray + sat * (r - gray);
        g = gray + sat * (g - gray);
        b = gray + sat * (b - gray);
        [r, g, b] = applyFilter(r, g, b, currentFilter);
        data[i] = Math.max(0, Math.min(255, r));
        data[i+1] = Math.max(0, Math.min(255, g));
        data[i+2] = Math.max(0, Math.min(255, b));
    }
    photoCtx.putImageData(imageData, 0, 0);
}

function applyFilter(r, g, b, f) {
    switch(f) {
        case 'grayscale': const gr = 0.2989*r + 0.587*g + 0.114*b; return [gr, gr, gr];
        case 'sepia': return [r*0.393+g*0.769+b*0.189, r*0.349+g*0.686+b*0.168, r*0.272+g*0.534+b*0.131];
        case 'vintage': return [r*0.9+40, g*0.8+20, b*0.6];
        case 'cold': return [r*0.9, g, b*1.1+20];
        case 'warm': return [r*1.1+20, g*1.05, b*0.9];
        case 'vivid': const vg = 0.2989*r + 0.587*g + 0.114*b; return [vg+1.5*(r-vg), vg+1.5*(g-vg), vg+1.5*(b-vg)];
        default: return [r, g, b];
    }
}

function renderFilters() {
    document.getElementById('filterGrid').innerHTML = filters.map(f => 
        `<button class="filter-btn ${f.id === currentFilter ? 'active' : ''}" onclick="setFilter('${f.id}')"><div class="filter-preview">${f.icon}</div><span class="filter-name">${f.name}</span></button>`
    ).join('');
}

function setFilter(f) { currentFilter = f; renderFilters(); renderPhoto(); }

function updatePhotoAdjustment() {
    ['brightness','contrast','saturation','exposure','temperature'].forEach(s => {
        const el = document.getElementById(s);
        if (el) {
            photoAdjustments[s] = parseFloat(el.value);
            const valEl = document.getElementById(s + 'Val');
            if (valEl) valEl.textContent = el.value;
        }
    });
    renderPhoto();
}

function resetAdjustments() {
    photoAdjustments = {brightness:0,contrast:0,saturation:0,exposure:0,temperature:0};
    currentFilter = 'none';
    Object.keys(photoAdjustments).forEach(k => {
        const el = document.getElementById(k);
        if (el) { el.value = 0; const v = document.getElementById(k + 'Val'); if (v) v.textContent = '0'; }
    });
    renderFilters();
    if (originalImage) renderPhoto();
}

// Photo tool selection
function setPhotoTool(tool) {
    currentPhotoTool = tool;
    document.querySelectorAll('.photo-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    document.getElementById('toolLabel').textContent = tool.charAt(0).toUpperCase() + tool.slice(1);
    
    // Show/hide tool options
    document.querySelectorAll('[id^="toolOpts-"]').forEach(el => el.style.display = 'none');
    const optionsEl = document.getElementById('toolOpts-' + tool);
    if (optionsEl) optionsEl.style.display = 'block';
    
    // Handle crop tool
    if (tool === 'crop' && originalImage) {
        initCrop();
    } else {
        cancelCrop();
    }
    
    if (tool !== 'text' && tool !== 'select') deselectAllTextLayers();
    
    photoCanvas.style.cursor = (tool === 'brush' || tool === 'eraser') ? 'crosshair' : (tool === 'text' ? 'text' : 'default');
}

// ==================== BRUSH & ERASER ====================
function onCanvasMouseDown(e) {
    if (!originalImage) return;
    const rect = photoCanvas.getBoundingClientRect();
    const scaleX = photoCanvas.width / rect.width;
    const scaleY = photoCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    if (currentPhotoTool === 'brush' || currentPhotoTool === 'eraser') {
        isDrawing = true;
        lastX = x; lastY = y;
        draw(x, y);
    } else if (currentPhotoTool === 'text') {
        addTextLayerAtPosition(x, y);
    }
}

function onCanvasMouseMove(e) {
    if (!isDrawing || !originalImage) return;
    const rect = photoCanvas.getBoundingClientRect();
    const scaleX = photoCanvas.width / rect.width;
    const scaleY = photoCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    draw(x, y);
    lastX = x; lastY = y;
}

function onCanvasMouseUp() {
    if (isDrawing) {
        isDrawing = false;
        photoCtx.drawImage(overlayCanvas, 0, 0);
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        const img = new Image();
        img.onload = () => { originalImage = img; savePhotoState(); };
        img.src = photoCanvas.toDataURL();
    }
}

function draw(x, y) {
    const ctx = currentPhotoTool === 'eraser' ? photoCtx : overlayCtx;
    const size = currentPhotoTool === 'brush' ? parseInt(document.getElementById('brushSize').value) : parseInt(document.getElementById('eraserSize').value);
    
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (currentPhotoTool === 'brush') {
        const color = document.getElementById('brushColor').value;
        const opacity = parseInt(document.getElementById('brushOpacity').value) / 100;
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = color;
        ctx.globalCompositeOperation = 'source-over';
    } else {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'destination-out';
    }
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
}

// ==================== CROP TOOL ====================
function initCrop() {
    if (!originalImage) return;
    document.getElementById('cropOverlay').classList.add('active');
    cropState.x = photoCanvas.width * 0.1;
    cropState.y = photoCanvas.height * 0.1;
    cropState.width = photoCanvas.width * 0.8;
    cropState.height = photoCanvas.height * 0.8;
    cropState.active = true;
    updateCropUI();
}

function updateCropUI() {
    const box = document.getElementById('cropBox');
    const rect = photoCanvas.getBoundingClientRect();
    const scaleX = rect.width / photoCanvas.width;
    const scaleY = rect.height / photoCanvas.height;
    
    box.style.left = (cropState.x * scaleX) + 'px';
    box.style.top = (cropState.y * scaleY) + 'px';
    box.style.width = (cropState.width * scaleX) + 'px';
    box.style.height = (cropState.height * scaleY) + 'px';
}

function onCropMouseDown(e) {
    if (!cropState.active) return;
    cropState.dragging = true;
    cropState.handle = null;
    cropState.startX = e.clientX;
    cropState.startY = e.clientY;
    cropState.startCropX = cropState.x;
    cropState.startCropY = cropState.y;
}

function onCropHandleMouseDown(e) {
    if (!cropState.active) return;
    cropState.dragging = true;
    cropState.handle = e.target.dataset.handle;
    cropState.startX = e.clientX;
    cropState.startY = e.clientY;
    cropState.startCropX = cropState.x;
    cropState.startCropY = cropState.y;
    cropState.startCropW = cropState.width;
    cropState.startCropH = cropState.height;
}

function onCropMouseMove(e) {
    if (!cropState.dragging || !cropState.active) return;
    
    const rect = photoCanvas.getBoundingClientRect();
    const scaleX = photoCanvas.width / rect.width;
    const scaleY = photoCanvas.height / rect.height;
    const dx = (e.clientX - cropState.startX) * scaleX;
    const dy = (e.clientY - cropState.startY) * scaleY;
    
    if (!cropState.handle) {
        cropState.x = Math.max(0, Math.min(photoCanvas.width - cropState.width, cropState.startCropX + dx));
        cropState.y = Math.max(0, Math.min(photoCanvas.height - cropState.height, cropState.startCropY + dy));
    } else {
        let newX = cropState.startCropX, newY = cropState.startCropY;
        let newW = cropState.startCropW, newH = cropState.startCropH;
        
        if (cropState.handle.includes('l')) { newX = cropState.startCropX + dx; newW = cropState.startCropW - dx; }
        if (cropState.handle.includes('r')) { newW = cropState.startCropW + dx; }
        if (cropState.handle.includes('t')) { newY = cropState.startCropY + dy; newH = cropState.startCropH - dy; }
        if (cropState.handle.includes('b')) { newH = cropState.startCropH + dy; }
        
        if (newW < 20) newW = 20;
        if (newH < 20) newH = 20;
        
        const aspectSelect = document.getElementById('cropAspect').value;
        if (aspectSelect !== 'free') {
            const [aw, ah] = aspectSelect.split(':').map(Number);
            const targetRatio = aw / ah;
            if (cropState.handle.includes('l') || cropState.handle.includes('r')) {
                newH = newW / targetRatio;
            } else {
                newW = newH * targetRatio;
            }
        }
        
        newX = Math.max(0, newX);
        newY = Math.max(0, newY);
        if (newX + newW > photoCanvas.width) newW = photoCanvas.width - newX;
        if (newY + newH > photoCanvas.height) newH = photoCanvas.height - newY;
        
        cropState.x = newX; cropState.y = newY; cropState.width = newW; cropState.height = newH;
    }
    
    updateCropUI();
}

function onCropMouseUp() {
    cropState.dragging = false;
    cropState.handle = null;
}

function updateCropAspect() {
    if (!cropState.active) return;
    const aspectSelect = document.getElementById('cropAspect').value;
    if (aspectSelect === 'free') return;
    
    const [aw, ah] = aspectSelect.split(':').map(Number);
    const targetRatio = aw / ah;
    const currentRatio = cropState.width / cropState.height;
    
    if (currentRatio > targetRatio) {
        cropState.width = cropState.height * targetRatio;
    } else {
        cropState.height = cropState.width / targetRatio;
    }
    updateCropUI();
}

function applyCrop() {
    if (!cropState.active || !originalImage) return;
    
    const tc = document.createElement('canvas');
    tc.width = cropState.width; tc.height = cropState.height;
    const tx = tc.getContext('2d');
    tx.drawImage(photoCanvas, cropState.x, cropState.y, cropState.width, cropState.height, 0, 0, cropState.width, cropState.height);
    
    photoCanvas.width = cropState.width; photoCanvas.height = cropState.height;
    overlayCanvas.width = cropState.width; overlayCanvas.height = cropState.height;
    photoCtx.drawImage(tc, 0, 0);
    
    const img = new Image();
    img.onload = () => {
        originalImage = img;
        document.getElementById('photoInfo').textContent = `${img.width} × ${img.height}px`;
        savePhotoState();
        photoZoomFit();
    };
    img.src = photoCanvas.toDataURL();
    
    cancelCrop();
    setPhotoTool('select');
    toast('success', 'Image cropped');
}

function cancelCrop() {
    cropState.active = false;
    document.getElementById('cropOverlay').classList.remove('active');
}

// ==================== TEXT TOOL ====================
function addTextLayer() {
    if (!originalImage) return;
    addTextLayerAtPosition(photoCanvas.width / 2, photoCanvas.height / 2);
}

function addTextLayerAtPosition(x, y) {
    const id = 'text-' + textIdCounter++;
    const container = document.getElementById('textLayersContainer');
    const rect = photoCanvas.getBoundingClientRect();
    const scaleX = rect.width / photoCanvas.width;
    const scaleY = rect.height / photoCanvas.height;
    
    const layer = document.createElement('div');
    layer.className = 'text-layer';
    layer.id = id;
    layer.style.left = (x * scaleX - 50) + 'px';
    layer.style.top = (y * scaleY - 20) + 'px';
    layer.innerHTML = `<div class="text-layer-content" contenteditable="true">Text</div><button class="text-delete" onclick="deleteTextLayer('${id}')">×</button>`;
    
    const content = layer.querySelector('.text-layer-content');
    applyTextStyles(content);
    
    layer.addEventListener('mousedown', e => {
        if (e.target.classList.contains('text-delete')) return;
        selectTextLayer(id);
        startDragTextLayer(e, layer);
    });
    
    content.addEventListener('dblclick', () => content.focus());
    content.addEventListener('input', () => {
        const layerData = textLayers.find(l => l.id === id);
        if (layerData) layerData.text = content.textContent;
    });
    
    container.appendChild(layer);
    
    textLayers.push({
        id, x: x/photoCanvas.width, y: y/photoCanvas.height, text: 'Text',
        font: document.getElementById('textFont').value,
        size: parseInt(document.getElementById('textSize').value),
        color: document.getElementById('textColor').value,
        bold: document.getElementById('textBold').checked,
        stroke: document.getElementById('textStroke').value,
        strokeWidth: parseInt(document.getElementById('textStrokeWidth').value)
    });
    
    selectTextLayer(id);
}

function selectTextLayer(id) {
    deselectAllTextLayers();
    selectedTextLayer = id;
    const layer = document.getElementById(id);
    if (layer) layer.classList.add('selected');
    
    const layerData = textLayers.find(l => l.id === id);
    if (layerData) {
        document.getElementById('textFont').value = layerData.font;
        document.getElementById('textSize').value = layerData.size;
        document.getElementById('textSizeVal').textContent = layerData.size + 'px';
        document.getElementById('textColor').value = layerData.color;
        document.getElementById('textBold').checked = layerData.bold;
        document.getElementById('textStroke').value = layerData.stroke;
        document.getElementById('textStrokeWidth').value = layerData.strokeWidth;
        document.getElementById('textStrokeVal').textContent = layerData.strokeWidth;
    }
}

function deselectAllTextLayers() {
    selectedTextLayer = null;
    document.querySelectorAll('.text-layer').forEach(l => l.classList.remove('selected'));
}

function deleteTextLayer(id) {
    const layer = document.getElementById(id);
    if (layer) layer.remove();
    textLayers = textLayers.filter(l => l.id !== id);
    if (selectedTextLayer === id) selectedTextLayer = null;
}

function updateSelectedText() {
    if (!selectedTextLayer) return;
    const layer = document.getElementById(selectedTextLayer);
    if (!layer) return;
    const content = layer.querySelector('.text-layer-content');
    applyTextStyles(content);
    
    const layerData = textLayers.find(l => l.id === selectedTextLayer);
    if (layerData) {
        layerData.font = document.getElementById('textFont').value;
        layerData.size = parseInt(document.getElementById('textSize').value);
        layerData.color = document.getElementById('textColor').value;
        layerData.bold = document.getElementById('textBold').checked;
        layerData.stroke = document.getElementById('textStroke').value;
        layerData.strokeWidth = parseInt(document.getElementById('textStrokeWidth').value);
    }
}

function applyTextStyles(content) {
    content.style.fontFamily = document.getElementById('textFont').value;
    content.style.fontSize = document.getElementById('textSize').value + 'px';
    content.style.color = document.getElementById('textColor').value;
    content.style.fontWeight = document.getElementById('textBold').checked ? 'bold' : 'normal';
    const sw = document.getElementById('textStrokeWidth').value;
    content.style.webkitTextStroke = sw > 0 ? `${sw}px ${document.getElementById('textStroke').value}` : 'none';
}

let dragTextLayer = null, dragOffsetX = 0, dragOffsetY = 0;

function startDragTextLayer(e, layer) {
    dragTextLayer = layer;
    const rect = layer.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    document.addEventListener('mousemove', onDragTextLayer);
    document.addEventListener('mouseup', stopDragTextLayer);
}

function onDragTextLayer(e) {
    if (!dragTextLayer) return;
    const container = document.getElementById('photoCanvasWrapper');
    const containerRect = container.getBoundingClientRect();
    dragTextLayer.style.left = (e.clientX - containerRect.left - dragOffsetX) + 'px';
    dragTextLayer.style.top = (e.clientY - containerRect.top - dragOffsetY) + 'px';
}

function stopDragTextLayer() {
    dragTextLayer = null;
    document.removeEventListener('mousemove', onDragTextLayer);
    document.removeEventListener('mouseup', stopDragTextLayer);
}

// ==================== PHOTO UTILITIES ====================
function photoZoom(d) {
    photoZoomLevel = Math.max(10, Math.min(400, photoZoomLevel + d));
    document.getElementById('photoZoomValue').textContent = photoZoomLevel + '%';
    document.getElementById('photoCanvasWrapper').style.transform = `scale(${photoZoomLevel/100})`;
}

function photoZoomFit() {
    if (!originalImage) return;
    const c = document.getElementById('photoCanvasContainer');
    const sx = (c.clientWidth - 40) / originalImage.width;
    const sy = (c.clientHeight - 40) / originalImage.height;
    photoZoomLevel = Math.round(Math.min(sx, sy, 1) * 100);
    document.getElementById('photoZoomValue').textContent = photoZoomLevel + '%';
    document.getElementById('photoCanvasWrapper').style.transform = `scale(${photoZoomLevel/100})`;
}

function photoRotate(deg) {
    if (!originalImage) return;
    const tc = document.createElement('canvas'), tx = tc.getContext('2d');
    if (Math.abs(deg) === 90) { tc.width = photoCanvas.height; tc.height = photoCanvas.width; }
    else { tc.width = photoCanvas.width; tc.height = photoCanvas.height; }
    tx.translate(tc.width/2, tc.height/2);
    tx.rotate(deg * Math.PI / 180);
    tx.drawImage(photoCanvas, -photoCanvas.width/2, -photoCanvas.height/2);
    photoCanvas.width = tc.width; photoCanvas.height = tc.height;
    overlayCanvas.width = tc.width; overlayCanvas.height = tc.height;
    photoCtx.drawImage(tc, 0, 0);
    const img = new Image();
    img.onload = () => { originalImage = img; document.getElementById('photoInfo').textContent = `${img.width} × ${img.height}px`; savePhotoState(); };
    img.src = photoCanvas.toDataURL();
}

function photoFlip(dir) {
    if (!originalImage) return;
    const tc = document.createElement('canvas');
    tc.width = photoCanvas.width; tc.height = photoCanvas.height;
    const tx = tc.getContext('2d');
    if (dir === 'h') { tx.translate(tc.width, 0); tx.scale(-1, 1); }
    else { tx.translate(0, tc.height); tx.scale(1, -1); }
    tx.drawImage(photoCanvas, 0, 0);
    photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
    photoCtx.drawImage(tc, 0, 0);
    const img = new Image();
    img.onload = () => { originalImage = img; savePhotoState(); };
    img.src = photoCanvas.toDataURL();
}

function photoAutoEnhance() {
    document.getElementById('brightness').value = 5;
    document.getElementById('contrast').value = 10;
    document.getElementById('saturation').value = 15;
    document.getElementById('exposure').value = 5;
    updatePhotoAdjustment();
    toast('success', 'Auto enhance applied');
}

function savePhotoState() {
    if (!originalImage) return;
    photoHistory = photoHistory.slice(0, photoHistoryIndex + 1);
    photoHistory.push(photoCanvas.toDataURL());
    photoHistoryIndex++;
    if (photoHistory.length > 50) { photoHistory.shift(); photoHistoryIndex--; }
}

function photoUndo() {
    if (photoHistoryIndex > 0) { photoHistoryIndex--; loadPhotoState(photoHistory[photoHistoryIndex]); }
}

function photoRedo() {
    if (photoHistoryIndex < photoHistory.length - 1) { photoHistoryIndex++; loadPhotoState(photoHistory[photoHistoryIndex]); }
}

function loadPhotoState(url) {
    const img = new Image();
    img.onload = () => {
        photoCanvas.width = img.width; photoCanvas.height = img.height;
        overlayCanvas.width = img.width; overlayCanvas.height = img.height;
        photoCtx.drawImage(img, 0, 0);
        originalImage = img;
    };
    img.src = url;
}

function exportPhoto() {
    if (!originalImage) return;
    
    // Flatten text layers
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = photoCanvas.width;
    exportCanvas.height = photoCanvas.height;
    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.drawImage(photoCanvas, 0, 0);
    
    const rect = photoCanvas.getBoundingClientRect();
    const scaleX = photoCanvas.width / rect.width;
    const scaleY = photoCanvas.height / rect.height;
    
    textLayers.forEach(layer => {
        const el = document.getElementById(layer.id);
        if (!el) return;
        const content = el.querySelector('.text-layer-content');
        const layerRect = el.getBoundingClientRect();
        const wrapperRect = document.getElementById('photoCanvasWrapper').getBoundingClientRect();
        const x = (layerRect.left - wrapperRect.left) * scaleX;
        const y = (layerRect.top - wrapperRect.top) * scaleY + layer.size;
        
        exportCtx.font = `${layer.bold ? 'bold ' : ''}${layer.size}px ${layer.font}`;
        exportCtx.fillStyle = layer.color;
        if (layer.strokeWidth > 0) {
            exportCtx.strokeStyle = layer.stroke;
            exportCtx.lineWidth = layer.strokeWidth * 2;
            exportCtx.strokeText(content.textContent, x, y);
        }
        exportCtx.fillText(content.textContent, x, y);
    });
    
    const fmt = document.getElementById('photoExportFormat').value;
    const q = document.getElementById('photoQuality').value / 100;
    const mime = fmt === 'png' ? 'image/png' : fmt === 'jpeg' ? 'image/jpeg' : 'image/webp';
    const a = document.createElement('a');
    a.href = exportCanvas.toDataURL(mime, q);
    a.download = `edited-image.${fmt}`;
    a.click();
    toast('success', 'Image exported!');
}

// ==================== VIDEO EDITOR ====================
function handleVideoFile(file) {
    if (!file) return;
    videoFile = file;
    videoPlayer.src = URL.createObjectURL(file);
    videoPlayer.style.display = 'block';
    document.getElementById('videoEmpty').style.display = 'none';
    trimIn = 0; trimOut = null;
    updateTrimRegion();
}

function onVideoLoaded() {
    videoDuration = videoPlayer.duration;
    document.getElementById('videoDuration').textContent = formatTime(videoDuration);
    document.getElementById('videoTrimEnd').placeholder = videoDuration.toFixed(1);
    document.getElementById('timelineTime').textContent = `00:00 / ${formatTime(videoDuration)}`;
    renderTimeline();
}

function renderTimeline() {
    document.getElementById('videoTrack').innerHTML = `
        <div class="timeline-clip">
            <div class="timeline-clip-thumb"><video src="${URL.createObjectURL(videoFile)}" muted></video></div>
            <div class="timeline-clip-name">${videoFile.name}</div>
        </div>
    `;
}

function formatTime(s) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

function toggleVideoPlay() {
    if (!videoFile) return;
    if (videoPlayer.paused) { videoPlayer.play(); document.getElementById('videoPlayBtn').textContent = '⏸'; }
    else { videoPlayer.pause(); document.getElementById('videoPlayBtn').textContent = '▶'; }
}

function updateVideoTime() {
    const c = videoPlayer.currentTime, d = videoDuration || 1, p = (c/d) * 100;
    document.getElementById('videoCurrentTime').textContent = formatTime(c);
    document.getElementById('videoProgress').style.width = p + '%';
    document.getElementById('videoHandle').style.left = p + '%';
    const tracks = document.getElementById('timelineTracks');
    document.getElementById('timelinePlayhead').style.left = `calc(12px + ${p}% * (${tracks.clientWidth - 24}px) / 100)`;
    document.getElementById('timelineTime').textContent = `${formatTime(c)} / ${formatTime(d)}`;
}

let isScrubbing = false;

function onScrubberMouseDown(e) {
    if (!videoFile) return;
    isScrubbing = true;
    seekToPosition(e);
    document.addEventListener('mousemove', onScrubberMouseMove);
    document.addEventListener('mouseup', onScrubberMouseUp);
}

function onScrubberMouseMove(e) { if (isScrubbing) seekToPosition(e); }

function onScrubberMouseUp() {
    isScrubbing = false;
    document.removeEventListener('mousemove', onScrubberMouseMove);
    document.removeEventListener('mouseup', onScrubberMouseUp);
}

function seekToPosition(e) {
    const scrubber = document.getElementById('videoScrubber');
    const rect = scrubber.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    videoPlayer.currentTime = (x / rect.width) * videoDuration;
}

function setVolume(v) {
    videoPlayer.volume = v;
    document.getElementById('volumeBtn').textContent = v == 0 ? '🔇' : v < 0.5 ? '🔉' : '🔊';
}

function toggleMute() {
    videoPlayer.muted = !videoPlayer.muted;
    document.getElementById('volumeBtn').textContent = videoPlayer.muted ? '🔇' : '🔊';
}

function setVideoTab(t) {
    document.querySelectorAll('.video-sidebar-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    document.querySelectorAll('.video-sidebar-panel').forEach(p => p.classList.toggle('active', p.id === 'videoTab-' + t));
}

function updateVideoSpeed() {
    const s = document.getElementById('videoSpeed').value;
    document.getElementById('videoSpeedVal').textContent = s + 'x';
    videoPlayer.playbackRate = parseFloat(s);
}

function setTrimStart() {
    trimIn = videoPlayer.currentTime;
    document.getElementById('videoTrimStart').value = trimIn.toFixed(1);
    updateTrimRegion();
    toast('info', `In: ${formatTime(trimIn)}`);
}

function setTrimEnd() {
    trimOut = videoPlayer.currentTime;
    document.getElementById('videoTrimEnd').value = trimOut.toFixed(1);
    updateTrimRegion();
    toast('info', `Out: ${formatTime(trimOut)}`);
}

function goToTrimStart() { videoPlayer.currentTime = parseFloat(document.getElementById('videoTrimStart').value) || 0; }
function goToTrimEnd() { videoPlayer.currentTime = parseFloat(document.getElementById('videoTrimEnd').value) || videoDuration; }

function updateTrimRegion() {
    const region = document.getElementById('videoTrimRegion');
    const inVal = parseFloat(document.getElementById('videoTrimStart').value) || 0;
    const outVal = parseFloat(document.getElementById('videoTrimEnd').value) || videoDuration;
    
    if (videoDuration > 0 && (inVal > 0 || outVal < videoDuration)) {
        region.style.display = 'block';
        region.style.left = (inVal / videoDuration * 100) + '%';
        region.style.width = ((outVal - inVal) / videoDuration * 100) + '%';
    } else {
        region.style.display = 'none';
    }
}

function resetTrim() {
    trimIn = 0; trimOut = null;
    document.getElementById('videoTrimStart').value = '';
    document.getElementById('videoTrimEnd').value = '';
    document.getElementById('videoTrimRegion').style.display = 'none';
}

function setVideoRotation(v) { document.getElementById('videoRotation').value = v; }

function captureFrame() {
    if (!videoFile) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoPlayer.videoWidth;
    canvas.height = videoPlayer.videoHeight;
    canvas.getContext('2d').drawImage(videoPlayer, 0, 0);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `frame-${formatTime(videoPlayer.currentTime).replace(':', '-')}.png`;
    a.click();
    toast('success', 'Frame captured!');
}

async function exportVideo() {
    if (!videoFile || !ffmpegLoaded) return;
    
    const progress = document.getElementById('exportProgress');
    const status = document.getElementById('exportStatus');
    progress.style.display = 'block';
    status.textContent = 'Processing...';
    
    const fmt = document.getElementById('videoExportFormat').value;
    const qual = document.getElementById('videoExportQuality').value;
    const res = document.getElementById('videoExportRes').value;
    
    const inputName = 'input' + videoFile.name.substring(videoFile.name.lastIndexOf('.'));
    const outputName = `output.${fmt}`;
    
    try {
        ffmpeg.FS('writeFile', inputName, await window.ffmpegFetchFile(videoFile));
        
        const args = [];
        const ts = document.getElementById('videoTrimStart').value;
        const te = document.getElementById('videoTrimEnd').value;
        
        if (ts) args.push('-ss', ts);
        args.push('-i', inputName);
        if (te) args.push('-t', String(parseFloat(te) - (parseFloat(ts) || 0)));
        
        if (fmt === 'gif') {
            const sc = res ? res.split(':')[0] : '480';
            args.push('-vf', `fps=15,scale=${sc}:-1:flags=lanczos`, '-loop', '0');
        } else {
            args.push('-c:v', 'libx264', '-crf', String(qualityCRF[qual]));
            
            const vf = [];
            if (res) {
                const [w, h] = res.split(':');
                vf.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`);
            }
            
            const rot = document.getElementById('videoRotation').value;
            if (rot === 'hflip' || rot === 'vflip') vf.push(rot);
            else if (rot) vf.push(`rotate=${rot}*PI/180`);
            
            const spd = document.getElementById('videoSpeed').value;
            if (spd && spd != 1) vf.push(`setpts=${1/parseFloat(spd)}*PTS`);
            
            const br = document.getElementById('vBrightness').value / 100;
            const ct = document.getElementById('vContrast').value / 100;
            const st = document.getElementById('vSaturation').value / 100;
            if (br || ct || st) vf.push(`eq=brightness=${br}:contrast=${1+ct}:saturation=${1+st}`);
            
            if (document.getElementById('effectGrayscale').checked) vf.push('colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3');
            if (document.getElementById('effectNegative').checked) vf.push('negate');
            if (document.getElementById('effectVignette').checked) vf.push('vignette');
            
            if (vf.length) args.push('-vf', vf.join(','));
            
            if (document.getElementById('audioRemove').checked) {
                args.push('-an');
            } else {
                args.push('-c:a', 'aac', '-b:a', '192k');
                const af = [];
                const vol = document.getElementById('audioVol').value / 100;
                if (vol != 1) af.push(`volume=${vol}`);
                if (spd && spd != 1) af.push(`atempo=${spd}`);
                if (af.length) args.push('-af', af.join(','));
            }
        }
        
        args.push('-y', outputName);
        await ffmpeg.run(...args);
        
        const data = ffmpeg.FS('readFile', outputName);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([data.buffer], {type: getMimeType(fmt)}));
        a.download = `edited-video.${fmt}`;
        a.click();
        
        ffmpeg.FS('unlink', inputName);
        ffmpeg.FS('unlink', outputName);
        
        progress.style.display = 'none';
        status.textContent = 'Export complete!';
        toast('success', 'Video exported!');
    } catch (e) {
        console.error(e);
        progress.style.display = 'none';
        status.textContent = 'Export failed';
        toast('error', 'Export failed');
    }
}

async function extractAudio() {
    if (!videoFile || !ffmpegLoaded) return;
    toast('info', 'Extracting audio...');
    
    const inputName = 'input' + videoFile.name.substring(videoFile.name.lastIndexOf('.'));
    const outputName = 'output.mp3';
    
    try {
        ffmpeg.FS('writeFile', inputName, await window.ffmpegFetchFile(videoFile));
        await ffmpeg.run('-i', inputName, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-y', outputName);
        const data = ffmpeg.FS('readFile', outputName);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([data.buffer], {type: 'audio/mpeg'}));
        a.download = 'extracted-audio.mp3';
        a.click();
        ffmpeg.FS('unlink', inputName);
        ffmpeg.FS('unlink', outputName);
        toast('success', 'Audio extracted!');
    } catch (e) {
        console.error(e);
        toast('error', 'Extraction failed');
    }
}

// Toast notifications
function toast(type, msg) {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span><span class="toast-text">${msg}</span>`;
    document.getElementById('toastContainer').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}
