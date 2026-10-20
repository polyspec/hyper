<!-- doc-id: hyper-build-readme -->
<!-- source-sha256: 652f4fbabca5303d6367b2b71952c24c3f3b689c92d5508f32cbf6bbff2d6219 -->
# @polyspec/hyper-build

[English](README.md).

영역 프로토콜의 build 명령이다(HR-96). 애플리케이션은 패키지를 설치하고 `node_modules/.bin`의 bin 두 개를 실행한다. 패키지는 브라우저 패키지 `@polyspec/hyper-client`와 템플릿 패키지 `@polyspec/template`, `@polyspec/template-compiler`를 자신이 요구하는 정확한 버전으로 읽는다(HR-70).

Node.js 26.12.0 이상이 필요하다. 패키지는 JavaScript 모듈을 build 단계 없이 그대로 publish한다.

## 서버 프로그램

`hyper-build-server`는 애플리케이션의 템플릿을 템플릿 규칙으로 검사하고 서버 프로그램을 `--output`에 쓴다. 예약 템플릿 `hyper/data.tpl`을 포함한 템플릿, 디렉터리 `php`에 PSR-4 파일로 쓴 namespace `--php-namespace`의 생성된 PHP 프로그램, `program.json`, read path `reads.json`이다(HY-48, HY-73). 애플리케이션은 `composer.json`의 `autoload.psr-4`에서 그 namespace를 그 디렉터리에 연결하며, PHP 서버는 이를 통해 프로그램을 불러온다.

```sh
npx hyper-build-server --manifest app/app.json --templates templates --output build/server --php-namespace 'App\Program'
```

```json
{
    "autoload": {
        "psr-4": {
            "App\\Program\\": "build/server/php/"
        }
    }
}
```

## 브라우저 asset

`hyper-build-assets`는 `app/app.json`, `templates/`, `client/main.ts`를 가진 애플리케이션 디렉터리 `--app`을 build한다. `public/assets` 아래에 템플릿 파일과 client entry와 그 chunk를 쓰고, `--output`에 `templates.index.json`, `manifest.json`, static shell `csr/`를 쓴다(HR-34, HYC-16). `--api`는 static shell의 데이터 base path이고, `--tailwind <source>=<output>`은 stylesheet를 Tailwind CSS로 컴파일하며(HR-77), `public/` 아래의 각 `--static` 파일은 static 배포에 들어간다.

```sh
npx hyper-build-assets --app . --api /api --output build --tailwind styles.css=public/assets/app.css --static public/assets/app.css
```

절차는 [개발](../../docs/operations/development.ko.md)에 있다.
