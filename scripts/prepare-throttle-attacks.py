"""Three real throttle openings. Source: ElementRS2, CC BY 4.0; see ASSET-SOURCES.md.
Usage: python scripts/prepare-throttle-attacks.py source.mp3 public/audio
"""
import hashlib,json,pathlib,subprocess,sys,wave
import numpy as np
from scipy import signal
source,output=map(pathlib.Path,sys.argv[1:3]);rate=44100
pcm=subprocess.check_output(['ffmpeg','-v','error','-i',str(source),'-f','f32le','-ac','1','-ar',str(rate),'-'])
recording=np.frombuffer(pcm,dtype='<f4').astype(np.float64)
report={'source':'https://freesound.org/people/ElementRS2/sounds/343686/','author':'ElementRS2','license':'CC-BY-4.0','takes':{}}
for index,(start,end) in enumerate([(4.65,5.75),(12.75,13.65),(18.1,19.0)]):
    samples=recording[int(start*rate):int(end*rate)].copy()
    samples=signal.sosfiltfilt(signal.butter(3,[70,5200],fs=rate,btype='bandpass',output='sos'),samples);samples-=samples.mean()
    samples*=min(.16/np.sqrt(np.mean(samples*samples)),.78/np.max(np.abs(samples)))
    fade_in,fade_out=int(.025*rate),int(.32*rate)
    samples[:fade_in]*=np.sin(np.linspace(0,np.pi/2,fade_in))**2;samples[-fade_out:]*=np.cos(np.linspace(0,np.pi/2,fade_out))**2
    path=output/f'scooter-attack-{index}.wav'
    with wave.open(str(path),'wb') as wav:
        wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(rate);wav.writeframes((samples*32767).astype('<i2').tobytes())
    report['takes'][str(index)]={'sourceSeconds':[start,end],'seconds':len(samples)/rate,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
(output/'scooter-attacks.json').write_text(json.dumps(report,indent=2)+'\n');print(report)
