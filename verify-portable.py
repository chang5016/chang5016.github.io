from pathlib import Path
import hashlib,json,sys
root=Path(__file__).resolve().parent
manifest=json.loads((root/'portable-package.json').read_text(encoding='utf-8'))
errors=[]
for item in manifest['files']:
    path=root/item['path']
    if not path.is_file():
        errors.append('Missing: '+item['path']);continue
    data=path.read_bytes()
    if item['path']=='.openai/hosting.json':
        settings=json.loads(data);settings.pop('project_id',None)
        data=(json.dumps(settings,indent=2)+'\n').encode()
    if len(data)!=item['bytes'] or hashlib.sha256(data).hexdigest()!=item['sha256']:
        errors.append('Changed or incomplete: '+item['path'])
if errors:
    print('Project verification failed:');print('\n'.join(errors));sys.exit(1)
hosting=json.loads((root/'.openai/hosting.json').read_text())
if 'project_id' in hosting:
    print('A new Site project has been assigned; file checks passed.')
print(f"Capy Cab v{manifest['version']}: all {len(manifest['files'])} project files verified.")
