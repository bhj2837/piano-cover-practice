# piano-cover-practice

유튜브 피아노 커버 영상을 막대가 떨어지는 연습 화면으로 바꿔 주는 개인 도구입니다.
PC 에서 링크를 곡 파일로 변환하고, 폰의 웹앱에서 그 파일을 불러와 연습합니다.

## 목차

1. 구성
2. 변환기 설치와 사용
3. 연습 앱
4. 곡 파일 형식
5. 주의

## 1. 구성

| 경로 | 내용 |
|---|---|
| `make_song.py` | 유튜브 링크를 곡 파일(`.pcsong`) 하나로 변환 |
| `transcribe.py` | 오디오를 MIDI 로 인식(Transkun, 비교용 ByteDance)하고 왼손과 오른손 트랙으로 나눔 |
| `app/` | 연습 웹앱(PWA). GitHub Pages 로 배포 |
| `preview.py`, `preview_template.html` | 모델별 인식 결과를 원음과 겹쳐 들어 보는 개발용 미리보기 |

변환 순서는 다음과 같습니다.

1. yt-dlp 로 음원을 받습니다.
2. Transkun 으로 음표를 인식합니다.
3. 가운데 도(C4)를 기준으로 왼손과 오른손을 나눕니다.
4. 원음을 1배, 0.75배, 0.5배 속도로 만들어 음표와 함께 한 파일에 담습니다.

## 2. 변환기 설치와 사용

필요한 것은 Python 3.11, [uv](https://docs.astral.sh/uv/), ffmpeg 입니다.

Windows:

```
winget install Gyan.FFmpeg
uv venv -p 3.11 .venv
uv pip install -p .venv -r requirements.txt
.venv\Scripts\python make_song.py "https://www.youtube.com/watch?v=..."
```

macOS:

```
brew install ffmpeg
uv venv -p 3.11 .venv
uv pip install -p .venv -r requirements.txt
.venv/bin/python make_song.py "https://www.youtube.com/watch?v=..."
```

결과는 `songs/<영상 제목>.pcsong` 에 생깁니다. 2분 30초 곡 기준으로 인식은 CPU 에서 약 20초, 파일은 약 10MB 입니다.

## 3. 연습 앱

폰 브라우저에서 앱 주소를 열고 홈 화면에 추가하면 앱처럼 실행됩니다. 한 번 연 뒤에는 인터넷 없이도 열립니다.

1. 곡 파일을 폰으로 옮깁니다(클라우드 드라이브, 메신저 등).
2. 앱에서 「곡 불러오기」로 파일을 고릅니다. 곡은 그 기기의 브라우저 저장소에만 저장됩니다.
3. 곡을 눌러 연습 화면을 엽니다.

연습 화면 기능은 다음과 같습니다.

- 한 손씩 보기와 듣기
- 속도 1배, 0.75배, 0.5배 (원음의 음높이는 유지)
- 소리 선택: 원음, 변환음, 둘 다, 끄기
- 구간 반복: 버튼을 한 번 누르면 시작점, 두 번 누르면 끝점, 세 번 누르면 해제
- 화면을 누르면 재생과 정지
- 설정: 막대 길이(건반을 누른 길이 또는 페달까지 포함한 길이), 떨어지는 속도, 재생 전 카운트다운, 싱크 보정

## 4. 곡 파일 형식

```
"PCS1" (4바이트) | JSON 길이 (4바이트, little endian) | JSON | 오디오 바이트
```

JSON 의 키는 다음과 같습니다.

| 키 | 내용 |
|---|---|
| `title`, `source`, `duration` | 영상 제목, 주소, 길이(초) |
| `notes` | `[시작, 건반을 뗀 시각, 음높이, 세기, 손(0 오른손, 1 왼손), 페달까지 포함한 끝]` 의 배열, 시작 시각 순 |
| `audio` | 속도별 mp3 의 `[오프셋, 길이]`. 오프셋은 JSON 이 끝난 지점부터 셉니다 |

## 5. 주의

- 개인 연습용입니다. 커버 연주의 권리는 원곡자와 연주자에게 있으므로 곡 파일과 음원은 이 저장소에 올리지 않습니다(`.gitignore`).
- 인식 결과에는 틀린 음이 섞여 있습니다. 정답 악보와 비교한 정확도 수치는 없습니다.
