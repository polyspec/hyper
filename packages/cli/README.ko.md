<!-- doc-id: hyper-cli-readme -->
<!-- source-sha256: 0264014a2053e349deab5dc0b0677767ac3c31c9794f7f1d71f62ca222cb3ac0 -->
# @polyspec/hyper-cli

[English](README.md).

영역 프로토콜의 명령 도구 `hyper`이며(HR-96), 하위 명령 `hyper build`와 `hyper check`를 가진다. 패키지는 브라우저 패키지 `@polyspec/hyper-client`와 템플릿 패키지 `@polyspec/template`, `@polyspec/template-compiler`를 자신이 요구하는 정확한 버전으로 읽는다(HR-70).

Node.js 26.12.0 이상. 패키지는 build 단계 없이 JavaScript module을 그대로 배포한다. hyper는 GitHub Release archive로만 릴리스되므로, 애플리케이션은 release의 `polyspec-hyper-cli-X.Y.Z.tgz`를 devDependency로 설치하고 bin을 `package.json` script나 `npm exec --package=@polyspec/hyper-cli -- hyper build`로 실행한다. 설치 없는 `npx hyper`와 `npm exec hyper`는 npm의 무관한 공개 package `hyper`를 실행하므로 쓰지 않는다.

호출자가 기대는 것은 bin, 인자, 종료 코드다: 성공은 0, 사용법 오류와 알 수 없는 하위 명령, 알 수 없는 option은 2, 실패는 1이다. stdout과 stderr의 문구는 interface가 아니다.

## 애플리케이션 디렉터리

`--app`은 `app/app.json`(매니페스트), `templates/`, 있을 수도 있는 `client/main.ts`(브라우저 진입 파일), `public/`을 담은 디렉터리 하나를 가리킨다.

## hyper build

```sh
hyper build --app . --output build --api /api --php-namespace 'App\Program' --tailwind styles.css=app --asset logo=images/logo.svg --static public/favicon.ico
```

한 번의 실행은 무엇이든 쓰기 전에 option, 매니페스트, 템플릿 규칙을 검사하고, 모든 출력으로 build id를 한 번 계산한다(HY-125). 다음을 쓴다(HR-34).

- `public/assets` 아래, 이름에 내용의 해시가 들어간 파일: 템플릿 파일, 클라이언트 진입 파일과 조각 파일, `--asset <name>=<path>`와 `--tailwind <source>=<name>`의 각 에셋(HR-77).
- `<output>/client/`: 레이아웃 코드가 읽는, `hyper`로 진입 파일의 URL과 이름마다 각 에셋의 URL을 담은 `manifest.json`, 쓰이는 어떤 build도 적지 않은 파일을 지우기 위해 이 build가 `public/assets` 아래에 쓴 모든 경로를 담은 `assets.json`, Node 서버가 읽는 `templates.index.json`과 `build.json`, 그리고 `client/main.ts`가 있고 `--api`가 주어지면 정적 셸 `csr/`.
- `<output>/program/`: 세 서버가 읽는 `templates/`, `reads.json`, `build.json`, 그리고 `--php-namespace`가 있으면 생성된 PHP 프로그램 `php/`와 `program.json`(HY-48).

에셋 이름은 `[a-z][a-z0-9-]*`에 맞고 `hyper`가 아니며 `hyper-`로 시작하지 않는다(HYC-16.13). build는 build id를 받지 않는다. `--output` 아래에서는 `client/`와 `program/`만 소유한다.

PHP 애플리케이션은 `composer.json`의 `autoload.psr-4`에서 namespace를 프로그램에 대응시킨다.

```json
{
    "autoload": {
        "psr-4": {
            "App\\Program\\": "build/program/php/"
        }
    }
}
```

## hyper check

```sh
hyper check --app .
```

매니페스트(HY-2)와 템플릿 규칙(HY-48.3)을 검사하며, 출력을 읽지 않고 파일을 쓰지 않는다.

절차는 [개발](../../docs/operations/development.ko.md)에 있다.
