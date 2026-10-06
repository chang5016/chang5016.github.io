"""Build sustained, non-revving engine textures from two licensed field recordings.
Usage: python scripts/prepare-scooter-audio.py idle.mp3 acceleration.mp3 public/audio
Offline only: ffmpeg, numpy, scipy. No oscillator or short repeated rev sequence.
"""
import hashlib, json, pathlib, subprocess, sys, wave
import numpy as np
from scipy import signal
from scipy.ndimage import uniform_filter1d, median_filter

idle_source, drive_source, output = map(pathlib.Path, sys.argv[1:4])
output.mkdir(parents=True, exist_ok=True)
rate = 44100
rng = np.random.default_rng(741)
def read(path):
    pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', str(rate), '-'])
    a = np.frombuffer(pcm, dtype='<f4').astype(np.float64)
    return signal.sosfiltfilt(signal.butter(3, [42, 6500], fs=rate, btype='bandpass', output='sos'), a)
def stabilize_pitch(a, target, bounds):
    # Track the combustion period in each real take, then remove the recorded
    # throttle sweep. All live layers must agree on pitch at the same RPM.
    analysis_rate = 4000
    low = signal.resample_poly(a, 40, 441)
    low = signal.sosfiltfilt(signal.butter(3, [30, 900], fs=analysis_rate, btype='bandpass', output='sos'), low)
    frame,hop = 640,160
    win = signal.windows.hann(frame)
    norm = signal.correlate(win,win,mode='full')[frame-1:]
    times,frequencies = [],[]
    minlag,maxlag = int(analysis_rate/bounds[1]),int(analysis_rate/bounds[0])
    for start in range(0,len(low)-frame+1,hop):
        part=low[start:start+frame]*win
        ac=signal.correlate(part,part,mode='full',method='fft')[frame-1:]/np.maximum(norm,1e-6)
        peaks=signal.find_peaks(ac[minlag:maxlag])[0]+minlag
        lag=peaks[np.argmax(ac[peaks])] if len(peaks) else np.argmax(ac[minlag:maxlag])+minlag
        times.append((start+frame/2)/analysis_rate);frequencies.append(analysis_rate/lag)
    freq=median_filter(np.array(frequencies),size=5,mode='nearest')
    f=np.interp(np.arange(len(a))/rate,times,freq)
    time=np.cumsum(f/target);time-=time[0]
    return np.interp(np.arange(int(time[-1])),time,a), float(np.median(freq))

idle, drive = read(idle_source), read(drive_source)
report = {'sources': [
    {'source': 'https://freesound.org/people/Kang_Alpin/sounds/676835/', 'author': 'Kang_Alpin', 'license': 'CC0-1.0', 'sha256': hashlib.sha256(idle_source.read_bytes()).hexdigest()},
    {'source': 'https://freesound.org/people/ElementRS2/sounds/343686/', 'author': 'ElementRS2', 'license': 'CC-BY-4.0', 'sha256': hashlib.sha256(drive_source.read_bytes()).hexdigest()},
], 'processing': 'Distinct idle and recorded acceleration takes. Excludes clipped rev at 15–17 seconds. Sustain regions resampled by phase-aligned overlapping grains, recorded RPM sweeps and volume swells removed; four-stroke pulse reference RPM / 120, 44.1 kHz mono, long unequal loop lengths, 0.18-second loop crossfade. Real-time CVT crossfades four registers continuously without resetting playback.', 'loops': {}}
# These are sustain windows, not complete throttle-up / throttle-down recordings.
specs = [
    ('idle', idle, [(48,60),(62,74),(76,83)], 17.31, .62),
    ('cruise', drive, [(5.3,6),(8.1,8.7),(12,12.6),(23.2,24.8)], 19.73, .38),
    ('pull', drive, [(6.3,7),(9,9.65),(10.7,11.55),(13.3,14.1),(18.1,18.9)], 23.47, .32),
    ('high', drive, [(7,7.65),(9.1,9.8),(11.05,11.75),(14,14.7),(19,19.75)], 29.11, .29),
]
for name, recording, regions, duration, grain_seconds in specs:
    bank = []
    reference = dict(idle=1800,cruise=3300,pull=4700,high=6400)[name]/120
    original_pitch = []
    for start,end in regions:
        a = recording[int(start*rate):int(end*rate)].copy()
        a,pitch = stabilize_pitch(a, reference, (18,42) if name=='idle' else (35,70))
        original_pitch.append(pitch)
        # Remove the field recording's rev-volume envelope. Player throttle is
        # the only source of that envelope in game; leave individual engine pulses.
        rms = np.sqrt(uniform_filter1d(a*a, int(.11*rate), mode='reflect') + 1e-9)
        a *= .15 / np.maximum(rms, .003)
        bank.append(a)
    count = int(duration*rate)
    grain = int(grain_seconds*rate)
    overlap = int(.13*rate)
    search = int(.012*rate)
    samples = np.zeros(count+grain*2)
    first = bank[0][:grain].copy(); samples[:grain] = first
    end = grain
    previous = -1
    while end < count+overlap:
        choice = int(rng.integers(len(bank)))
        if choice == previous: choice = (choice+1) % len(bank)
        previous = choice
        source = bank[choice]
        start = int(rng.integers(search, max(search+1,len(source)-grain-search)))
        # Align the periodic exhaust pressure at every overlap, rather than
        # fading unrelated phases into a hollow/flanging sound.
        target = samples[end-overlap:end]
        candidates = source[start-search:start+search+overlap]
        correlation = signal.correlate(candidates[::4],target[::4],mode='valid',method='fft')
        offset = int(np.argmax(correlation))*4
        start = start-search+offset
        chunk = source[start:start+grain].copy()
        if len(chunk)<grain: continue
        t = np.linspace(0,1,overlap)
        fade = .5-.5*np.cos(np.pi*t)
        samples[end-overlap:end] = target*(1-fade)+chunk[:overlap]*fade
        samples[end:end+grain-overlap] = chunk[overlap:]
        end += grain-overlap
    samples = samples[:count]
    # A second gentle envelope pass prevents dips where source grains differ.
    envelope=np.sqrt(uniform_filter1d(samples*samples,int(.18*rate),mode='wrap')+1e-9)
    samples *= .15/np.maximum(envelope,.02)
    fade=int(.18*rate);t=np.linspace(0,1,fade);mix=.5-.5*np.cos(np.pi*t)
    samples=np.concatenate([samples[-fade:]*(1-mix)+samples[:fade]*mix,samples[fade:-fade]])
    samples-=samples.mean()
    samples*=min(.15/np.sqrt(np.mean(samples*samples)),.83/np.max(np.abs(samples)))
    seam=np.argmin(np.abs(np.diff(samples))+.025*np.abs(samples[1:]))+1
    samples=np.roll(samples,-seam)
    quantized=np.round(samples*32767).astype('<i2')
    path=output/f'scooter-{name}.wav'
    with wave.open(str(path),'wb') as f:
        f.setparams((1,2,rate,len(samples),'NONE','not compressed'));f.writeframes(quantized.tobytes())
    windows=np.array([np.sqrt(np.mean(s*s)) for s in np.array_split(samples, int(len(samples)/rate/.3))])
    report['loops'][name]={'seconds':len(samples)/rate,'sourceRegions':regions,'referencePulseHz':reference,'sourceMedianPulseHz':original_pitch,'rms':float(np.sqrt(np.mean(samples*samples))),'peak':float(np.max(np.abs(samples))),'envelopeWindowSeconds':.3,'envelopeVariation':float(windows.std()/windows.mean()),'seamDelta':float(abs(samples[-1]-samples[0])),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}
(output/'scooter-recordings.json').write_text(json.dumps(report,indent=2)+'\n')
old=output/'scooter-drive.wav'
if old.exists():old.unlink()
print(json.dumps(report['loops'],indent=2))
