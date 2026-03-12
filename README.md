# Portfolio Video Paths

`videos` 폴더의 mp4/webm/mov 파일을 Vercel 정적 사이트로 배포할 수 있게 빌드합니다.

- 자동재생: `autoplay`
- 무음: `muted`
- 반복재생: `loop`
- 모바일 호환: `playsinline`
- 비율 유지 + 검은 레터박스: `object-fit: contain` + `background: #000`

## 로컬 빌드

```bash
npm run build
```

빌드 결과물은 `dist/`에 생성됩니다.

## CDN 매핑


- 플레이어는 먼저 CDN URL로 재생을 시도하고, 실패하면 자동으로 로컬 `/videos/<filename>`로 fallback 됩니다.
- `video-cdn-map.json`에 `slug: CDN_URL` 형태를 넣으면 특정 영상 CDN URL만 개별 override 할 수 있습니다.
- 빌드 시 로컬 fallback용 파일은 항상 `dist/videos`에 복사됩니다.
- CDN base를 바꾸려면 빌드 시 `VIDEO_CDN_BASE` 환경변수를 사용하세요.

## 경로 규칙

- 원본 파일: `/videos/<파일명>`
- 재생 페이지: `/<파일명에서 확장자 제거한 slug>`

예시:

- 파일: `videos/2-1_interactive_menabi_main.mp4`
- 재생 페이지: `https://<your-domain>/2-1_interactive_menabi_main`

루트(`/`)에는 전체 영상 경로 목록이 표시됩니다.

## Vercel 배포

1. 이 폴더를 GitHub 저장소로 push
2. Vercel에서 해당 저장소 `Import`
3. 별도 설정 없이 배포

이 프로젝트는 `vercel.json`으로 아래가 고정되어 있습니다.

- Build Command: `npm run build`
- Output Directory: `dist`
- Clean URLs: `true` (`/slug` 형태 URL 사용)
