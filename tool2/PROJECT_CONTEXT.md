# JAEHO → SaaS ERP 전환 프로젝트 컨텍스트

> ⚠️ **공개용 사본입니다.** DB·ERP 계정 등 자격증명은 제거되어 있습니다.
> 원본(민감정보 포함)은 공개 저장소에 올리지 마세요.

> 생성: 2026-06 | 용도: 신규 대화창 시작 시 이 파일을 첨부하면 전체 맥락 즉시 복원

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 목표 | 기존 JAEHO ERP 분석 → SaaS형 멀티테넌트 ERP 신규 구축 |
| 대상 | 본사 적용 → 지사 확장 → 외부 상업 판매 |
| IP 귀속 | 발주사(현 회사) 100% 귀속. 태성S&C 납품 제품. 디컴파일·참조 자유 |
| 추진 전략 | 서울 부설연구소 설립 → 10인/24개월 → 스핀오프(분사) |
| 예산 | 약 22억 (정부지원 5~6억 포함, 실투자 14~15억) |
| 현황 | 경영진 설득 소강상태. 재설득 보고서 작성 완료 |

---

## 2. 기존 JAEHO 시스템 확정 정보

### 2.1 기술스택 (확정)
- **플랫폼**: .NET Framework 4.0 + Windows Forms
- **DB**: MS-SQL Server, DB명 `JAEHO.db`, 크기 **11GB**
- **DB 계정**: (별도 보관 — 공개 저장소 제외)
- **ERP 로그인**: (별도 보관 — 공개 저장소 제외)
- **설치경로**: C:\JaehoSys (루트 직접배치 구조)
- **개발사**: 태성S&C (tssoft.kr, TSSC)
- **설치일**: 2019년 12월 / 최종 DB백업: 2022년 2월

### 2.2 디렉토리 구조 (확정)
```
C:\JaehoSys\                 ← 실행루트. 모든 EXE·DLL 직접배치
├── JaehoMain.exe            ← 메인 ERP
├── JaehoMain.exe.config     ← DB접속·경로설정
├── [업무모듈 DLL 9종]
├── [DevExpress v13.1 27종]
├── [FarPoint 7종]
├── DaumMapEx.dll / TSSC.Core.dll
├── JAEHO.db_backup_2022_02_28.bak
├── JaehoSetup.msi / setup.exe
└── 재호계정.txt
C:\JaehoSys\down2\           ← 로그인 모듈
├── JaehoLogin.exe           ← 런처 (로그인 후 JaehoMain 실행)
└── JaehoLogin.exe.config    ← Main config와 내용 동일
C:\JaehoSys\ini\             ← 세션설정
└── tsConfig.ini             ← USERNO=SYSTEM, COCD=1000, SKIN=Blue
C:\JaehoSys\down1\           ← 업데이트 임시폴더 (비어있음)
```

### 2.3 config 핵심 설정 (확정)
```xml
_MesRealServer = (local)        ← 로컬구동시 (local)\SQLEXPRESS로 수정 필요
_MesRealDB     = JAEHO.db
_MesRealUID    = (별도 보관)
_MesRealPwd    = (별도 보관)
_FileDownloadUrl = http://sf.tssoft.kr:61501/jaeho   ← 단절. 빈값처리 필요
_FtpServerUrl    = ftp://sf.tssoft.kr/ftp.tssc.kr/jaeho ← 단절. 빈값처리 필요
_TSLocation    = C:\JaehoSys
_ExeFilename   = JaehoMain
Oracle/POP/ERP_COMMON/ERP_WORK = 전체 빈값 (설계만 됨, 미사용)
```

### 2.4 업무모듈 DLL (확정 9종)
| DLL | 추정 영역 |
|---|---|
| GEN005/010 | 공통기반/공통확장 |
| BIZ010/020 | 기준정보 기본/확장 |
| MAT010 | 자재관리 |
| PRD010 | 생산관리 |
| SAL010 | 영업관리 |
| TRA010 | 거래·전표 |
| TS020 | 거래처(정확한 의미 2차 확인) |

### 2.5 외부 라이브러리 (확정)
- **DevExpress v13.1 27종**: UI 전체 (2013년, 12년 경과, 폐기)
  - 주요: XtraBars, XtraGrid, XtraEditors, XtraNavBar, XtraCharts, XtraGauges, XtraPivotGrid, XtraPdfViewer, XtraLayout, XtraTreeList, XtraVerticalGrid, XtraMap 등
- **FarPoint 7종**: Spread, Excel, PDF, CalcEngine, Chart, Calendar, Localization (폐기)
- **DaumMapEx.dll**: 지도연동 (단절, 폐기)
- **TSSC.Core.dll**: 태성S&C 공통프레임워크 (IP귀속이므로 참조 가능, 단 의존성 주의)

### 2.6 실제 메뉴 구조 (화면 캡처 확정 - v2.0)
```
화면메뉴
├── 기준관리
│   ├── 기초정보관리: 공통코드, 은행코드, 은행별계좌, 결제조건, 회사관리, 사업장등록
│   └── 기준정보관리: 자금, 거래처(+무역+담당자), 품목, 장소/위치, BOM등록/전개,
│                     기초재고, 품목재고(실시간), 원자재BOM등록/전개
├── 영업관리
│   ├── 견적서관리: 견적서작성/현황
│   └── 수주관리: 기초채권, 수금, 주문서(작성/현황/일괄), 출고지시, 출고(현황/반품/예외),
│                 유통이력신고, 현금출납, 결재내역, 매출원장, 품목별수불대장, 출고반품
├── 무역관리 ★신규발견
│   ├── 기준정보: PI현황, BL등록
│   └── USANCE관리: Usance한도, 은행별한도/사용내역, 만기일조회
├── 생산관리공통
│   ├── 생산계획: 생산계획등록
│   ├── 작업지시: 작업지시등록(+확정)/현황
│   └── 작업실적: 생산실적등록/현황
└── 자재관리
    ├── 매입발주서관리: 기초채무, 지급, 품목별가격변동, 구매발주서(작성/현황/일괄),
    │                   입고(New/예외/현황/반품), 매입원장
    └── 재고이동관리: 재고이동(내부/사업장/사업장입고) 등록/현황
```
**핵심 발견**: 무역관리(USANCE) 존재 → 해외 원자재 수입 기반 제조업 확정
**BOM 연계**: 원자재BOM → 구매발주 → 작업지시 → 생산실적 (핵심 흐름)
**미확인**: 스크롤 하단 추가 메뉴(회계/인사 등) 존재 여부

### 2.7 운영 중단 원인 (확정)
1. **로컬 SQL Server 미구성** → Named Pipes error 40 → Dictionary 키 오류 연쇄
2. **외부 벤더 서버 단절** (sf.tssoft.kr HTTP/FTP) → 파일배포 연동 불가
3. COCD=1000 (멀티컴퍼니 구조 설계 확인)

---

## 3. 로컬 구동 작업 현황

### 3.1 필수 수정 3가지 (미완료)
```
① SQL Server Express 설치 + JAEHO.db 복원 (.bak)
   → 주의: DB 11GB > Express 10GB 한도 초과 가능
   → SQL Server Developer Edition(무료) 설치 권장

② config 수정 (JaehoMain.exe.config + JaehoLogin.exe.config 동일)
   _MesRealServer: (local) → (local)\SQLEXPRESS
   _FileDownloadUrl: → "" (빈값)
   _FtpServerUrl: → "" (빈값)

③ SQL 계정 생성
   - SQL Server 인증모드 변경 (혼합모드)
   - 로그인: (계정정보는 별도 보관) / db_owner 권한
```

### 3.2 구동 후 예상 문제
| 순위 | 문제 | 대응 |
|---|---|---|
| 1 | Named Pipes error 40 | SQL Server 설치·인스턴스명 확인 |
| 2 | 앱 시작 후 멈춤 | config URL 빈값처리 |
| 3 | 로그인 실패 | DB 사용자 테이블 조회 후 SYSTEM 계정 확인 |
| 4 | 특정 기능 오류 | TSSC.Core.dll 네트워크 호출 여부 확인 |

### 3.3 DB 11GB 이슈
- SQL Server Express: 10GB 한도 → 복원 실패 가능
- **SQL Server Developer Edition**: 무료, 용량 제한 없음 → 권장

---

## 4. 전환/참조/유지/폐기 최종 판단

| 구성요소 | 판단 | 근거 |
|---|---|---|
| DB 스키마 (JAEHO.db) | **참조 ★★★** | 실운영 데이터모델. 신규 SaaS DB설계 베이스라인 |
| 실제 메뉴·업무구조 | **참조 ★★★** | 5대분류 70개+ 화면. 도메인 설계 기준 |
| BOM·무역(USANCE) | **참조 ★★★** | 1차 추정에 없던 핵심 도메인. 신규 설계 필수 반영 |
| 업무모듈 분류체계 | **참조 ★★** | GEN/BIZ/MAT/PRD/SAL/TRA 도메인 경계 참조 |
| JaehoMain/Login.exe | **폐기** | WinForms→웹 전환 불가 |
| DevExpress v13.1 | **폐기** | 12년 경과, 웹 비호환 |
| FarPoint 전체 | **폐기** | WinForms 전용 |
| DaumMapEx | **폐기** | 카카오맵 웹API로 대체 |
| TSSC.Core.dll | **참조 가능** | IP 귀속 확정. 단 의존성 최소화 |
| 재호계정.txt | **유지(보안격리)** | DB복원 작업 후 파기 |

---

## 5. 사업화 전략 (확정된 입장)

### 5.1 원안 (재설득 중)
- 서울 부설연구소 설립 (인력풀·세제혜택)
- 10인 순차충원 / 24개월 / 스핀오프(분사) 설계
- 22억 (정부지원 5~6억, 실투자 14~15억)
- 정부지원: TIPS(최대 5억), 부설연구소 세액공제(인건비 25%), 벤처인증

### 5.2 핵심 논거 (보고서 작성 완료)
- AI는 코딩 20~30%만 대체. 도메인·보안·운영·인력은 대체 불가
- Brooks의 법칙: 본사 적용 후 인력 추가 = 더 느려짐 + IP노출
- 서울: 시니어 개발자 82% 집중. 부산 DevOps·보안 충원 사실상 불가
- 스핀오프: 스톡옵션·기술오너십으로 시니어 유인 유일한 수단
- 축소안 실패비용 = 원안의 3~5배

### 5.3 AI 역할 정의
| AI 가능 | AI 불가 |
|---|---|
| 코딩 생산성 30~50% 향상 | 도메인 업무로직 검증 |
| 문서화·분석 보조 | 보안 설계·침투테스트 |
| 반복코드 자동화 | 클라우드 24/7 장애대응 |
| 단순 UI 컴포넌트 | 고객사 요구사항 협의 |

---

## 6. 산출물 목록

| 파일명 | 내용 | 버전 |
|---|---|---|
| JAEHO_ERP_기술평가서_v2.0_확정판.docx | 전체 파일분석 기술평가서 | 확정 |
| SaaS_상업화_타당성_재검토_보고서.docx | 경영진 설득용 보고서 | 완료 |
| JAEHO_ERP_메뉴구조도_v1.0_추정.svg | DLL 기반 추정 구조도 | 참고용 |
| JAEHO_ERP_메뉴구조도_v2.0_확정.svg | 실제 메뉴 기반 확정 구조도 | 확정 |

---

## 7. 다음 작업 (우선순위)

| 순위 | 작업 | 대화창 | 상태 |
|---|---|---|---|
| 1 | SQL Server Developer Edition 설치·DB복원 | [02] 로컬구동 | 미착수 |
| 2 | 메뉴 하단 추가 캡처 (회계/인사 등) | [01] 분석 | 미착수 |
| 3 | SSMS DB 메뉴테이블 조회·ERD 역설계 | [03] DB분석 | 미착수 |
| 4 | ILSpy로 TSSC.Core.dll·업무모듈 분석 | [04] 코드분석 | 미착수 |
| 5 | 신규 SaaS 아키텍처 설계 (v3.0 구조도) | [05] 설계 | 미착수 |
| 6 | 경영진 재설득 추가 자료 필요시 | [06] 전략 | 대기 |

---

## 8. 대화창 구분 체계

```
[프로젝트: JAEHO → SaaS ERP 전환]
├── [01] 기존ERP 파일구조 분석     ← 현재 대화창 (완료)
├── [02] 로컬 환경 구동 작업
├── [03] DB 스키마 역설계
├── [04] 업무모듈 코드 분석
├── [05] SaaS 아키텍처 설계
├── [06] 전략·경영진 보고
└── [07] IP·특허 전략
```

---

## 9. 분석 미확인 항목 (2차 과제)

- TS020.dll 모듈의 정확한 업무 영역
- 화면 스크롤 하단 추가 메뉴 (회계관리·인사관리 존재 여부)
- DB 복원 후 실제 테이블 구조·ERD
- MenuLog.xml (아직 생성 안됨, 앱 정상구동 후 생성)
- TSSC.Core.dll 내부 네트워크 호출 여부
- down1 폴더 원래 용도 확인

---
> 이 파일을 새 대화창 시작 시 첨부하면 전체 맥락이 복원됩니다.
> 민감정보 포함 (DB계정·ERP계정). 외부 공유 금지.
