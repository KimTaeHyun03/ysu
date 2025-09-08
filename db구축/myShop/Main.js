/**
 * ====================================================================
 * 의류쇼핑몰 메인 서버 (Main.js) - MySQL 버전
 * ====================================================================
 * 
 * 역할: Express 기반 웹 애플리케이션의 중심 서버 파일
 *      전체 애플리케이션의 설정, 라우팅, 미들웨어 관리를 담당
 * 
 * 주요 기능:
 * - Express 서버 설정 및 미들웨어 구성
 * - 세션 관리 (메모리 기반)
 * - 정적 파일 서빙 (CSS, 이미지 등)
 * - 인증 기반 페이지 라우팅
 * - 메인 쇼핑 페이지 HTML 생성
 * - 상품 조회 API 제공
 * - 장바구니 추가 API 제공
 * 
 * 라우트 구조:
 * - GET  /                : 루트 페이지 (인증 확인 후 리다이렉트)
 * - GET  /main            : 메인 쇼핑 페이지
 * - GET  /api/products    : 상품 목록 조회 API
 * - POST /cart/add        : 장바구니 추가 API
 * - /auth/*               : 인증 관련 라우트 (auth.js에 위임)
 * - /cart/*               : 장바구니 관련 라우트 (cartView.js에 위임)
 * 
 * 아키텍처:
 * - MVC 패턴의 Controller 역할
 * - 모듈화된 라우터 시스템
 * - 세션 기반 인증 시스템
 * - RESTful API 설계
 * ====================================================================
 */

// ====================================================================
// 필요한 모듈 불러오기 (Dependencies)
// ====================================================================

// Express 관련 모듈
const express = require('express');                         // Express 웹 프레임워크 - 서버의 핵심
const session = require('express-session');                 // 세션 관리 미들웨어 - 로그인 상태 유지
const bodyParser = require('body-parser');                  // 요청 본문 파싱 미들웨어 - POST 데이터 처리

// Node.js 내장 모듈
const fs = require('fs');                                   // 파일 시스템 모듈 - 폴더 생성 및 파일 작업
const path = require('path');                               // 파일 경로 관리 모듈 - 정적 파일 경로 설정

// 보안 및 기능 확장 모듈
const cors = require('cors');                               // CORS 지원 미들웨어 - 클라이언트-서버 통신 허용

// 사용자 정의 모듈 (Custom Modules)
const authRouter = require('./auth.js');                    // 인증 관련 라우터 - 로그인/고객가입 처리
const authCheck = require('./authCheck.js');                // 인증 상태 확인 모듈 - 로그인 여부 검증
const db = require('./db.js');                              // 데이터베이스 연결 모듈 - MySQL 연결 풀 관리
const cartRouter = require('./cartView.js');                // 장바구니 관련 라우터 - 장바구니 CRUD 처리
const productDetailRouter = require('./prodDetail.js');     // 상품 상세보기 라우터 - 상품상세 보기
const mypageRouter = require('./myPage.js');                // 마이페이지 라우터 - 고객정보 및 주문내역(평가)

// ====================================================================
// Express 앱 생성 및 기본 설정
// ====================================================================

const app = express();                                    // Express 애플리케이션 인스턴스 생성
const port = 3000;                                        // 서버 포트 번호 설정

console.log('🚀 Express 애플리케이션 초기화 완료');

// ====================================================================
// 미들웨어 설정 (Middleware Configuration)
// ====================================================================

// CORS 설정 - 클라이언트와 서버 간 통신 허용
app.use(cors());                                          // Cross-Origin Resource Sharing 활성화
console.log('✅ CORS 미들웨어 설정 완료');

// 요청 본문 파싱 미들웨어 설정
app.use(express.json());                                  // JSON 형태의 요청 본문 파싱 (API 요청용)
app.use(bodyParser.urlencoded({ extended: true }));       // URL 인코딩된 요청 본문 파싱 (폼 데이터용)
console.log('✅ 요청 본문 파싱 미들웨어 설정 완료');

// ====================================================================
// 세션 저장소 설정 (Session Storage Configuration)
// ====================================================================

// 세션 파일을 저장할 디렉토리 경로 설정 (현재는 메모리 사용으로 미사용)
const sessionsDir = './sessions';

// sessions 폴더 생성 (파일 기반 세션 사용 시 필요, 현재는 준비 단계)
try {
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
    console.log('📁 sessions 폴더가 생성되었습니다:', sessionsDir);
  } else {
    console.log('📁 sessions 폴더가 이미 존재합니다');
  }
} catch (error) {
  console.error('❌ sessions 폴더 생성 실패:', error);
}

// ====================================================================
// 세션 미들웨어 설정 (Session Middleware)
// ====================================================================

app.use(session({
  // 세션 암호화를 위한 비밀 키 (실제 운영환경에서는 환경변수 사용 권장)
  secret: '~~~',                                          
  
  // 세션 저장 옵션
  resave: false,                                          // 세션이 변경되지 않아도 다시 저장할지 여부 (false 권장)
  saveUninitialized: false,                               // 초기화되지 않은 세션도 저장할지 여부 (false 권장)
  
  // 쿠키 설정
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,                          // 쿠키 유효기간: 24시간 (밀리초 단위)
    httpOnly: true,                                       // JavaScript에서 쿠키 접근 방지 (XSS 공격 방지)
    secure: false,                                        // HTTPS에서만 쿠키 전송 여부 (개발환경에서는 false)
    sameSite: 'lax'                                       // CSRF 공격 방지를 위한 SameSite 설정
  },
  
  // 세션 이름 설정 (기본 'connect.sid' 대신 사용자 정의명 사용)
  name: 'myShopSessionId'                                 // 세션 쿠키 이름 변경 (기존 쿠키와의 충돌 방지)
}));

console.log('✅ 메모리 기반 세션 설정 완료');

// ====================================================================
// 정적 파일 제공 설정 (Static File Serving)
// ====================================================================

// public 디렉토리의 파일들(CSS, JavaScript, 이미지 등)을 웹에서 접근 가능하게 설정
// 예: /public/style.css → http://localhost:3000/style.css
app.use(express.static(path.join(__dirname, 'public')));
console.log('✅ 정적 파일 제공 설정 완료:', path.join(__dirname, 'public'));

// ====================================================================
// 라우터 마운팅 (Router Mounting)
// ====================================================================

// 장바구니 관련 라우트 설정
// /cart로 시작하는 모든 요청은 cartRouter가 처리
// 예: /cart, /cart/add, /cart/:id 등
app.use('/cart', cartRouter);
console.log('✅ 장바구니 라우터 마운팅 완료: /cart/*');

// 인증 관련 라우트 설정  
// /auth로 시작하는 모든 요청은 authRouter가 처리
// 예: /auth/login, /auth/register, /auth/logout 등
app.use('/auth', authRouter);
console.log('✅ 인증 라우터 마운팅 완료: /auth/*');

// 상품 상세정보 라우터 설정
// /prod로 시작하는 모든 요청은 productDetailRouter가 처리
// 예: /prod/product/:prod_cd
app.use('/prod', productDetailRouter);

// 상품 상세정보 라우터 설정
// /mypage로 시작하는 모든 요청은 mypageRouter가 처리
// 예: /mypage
app.use('/mypage', mypageRouter);

// ====================================================================
// 서버 시작 (Server Initialization)
// ====================================================================

app.listen(port, () => {
  console.log(`🚀 FASHION STORE 서버가 포트 ${port}에서 실행 중입니다`);
  console.log(`🌐 접속 URL: http://localhost:${port}`);
  console.log(`📊 현재 시간: ${new Date().toLocaleString()}`);
});

// ====================================================================
// 메인 라우트 정의 (Main Routes)
// ====================================================================

/**
 * 루트 경로 라우트 - GET /
 * ================================================================
 * 
 * 기능: 웹사이트의 첫 진입점으로, 사용자의 로그인 상태를 확인하여
 *      적절한 페이지로 리다이렉트하는 역할
 * 
 * 처리 과정:
 * 1. authCheck.isOwner()로 로그인 상태 확인
 * 2. 로그인 안됨 → /auth/login으로 리다이렉트
 * 3. 로그인 됨 → /main으로 리다이렉트
 * 
 * 보안: 인증되지 않은 사용자는 자동으로 로그인 페이지로 이동
 * ================================================================
 */
app.get('/', (req, res) => {
  console.log('🔍 루트 경로 접근 - IP:', req.ip);
  
  // authCheck 모듈을 사용하여 로그인 상태 확인
  if (!authCheck.isOwner(req, res)) {  
    console.log('❌ 미인증 사용자 - 로그인 페이지로 리다이렉트');
    // 로그인 안되어있으면 로그인 페이지로 리다이렉트
    res.redirect('/auth/login');
    return false;
  } else {                             
    console.log('✅ 인증된 사용자 - 메인 페이지로 리다이렉트');
    // 로그인 되어있으면 메인 페이지로 리다이렉트
    res.redirect('/main');
    return false;
  }
});

/**
 * 메인 페이지 라우트 - GET /main
 * ================================================================
 * 
 * 기능: 로그인한 사용자에게 의류쇼핑몰의 메인 페이지를 제공
 *      완전한 HTML 페이지를 서버에서 생성하여 전송 (SSR)
 * 
 * 처리 과정:
 * 1. 로그인 상태 재확인 (보안 강화)
 * 2. 사용자 정보 추출 (ID, 이름)
 * 3. 완전한 HTML 페이지 생성
 * 4. 클라이언트로 HTML 전송
 * 
 * 포함 요소:
 * - 반응형 HTML 구조
 * - 사용자 정보 표시
 * - 상품 그리드 영역
 * - 클라이언트 사이드 JavaScript
 * ================================================================
 */
app.get('/main', (req, res) => {
  console.log('🏠 메인 페이지 요청 받음 - IP:', req.ip);
  
  // 로그인 상태 재확인 (보안 강화 - 직접 URL 접근 방지)
  if (!authCheck.isOwner(req, res)) {  
    console.log('❌ 메인 페이지 접근 시 인증 실패');
    res.redirect('/auth/login');
    return false;
  }
  
  // authCheck.statusUI()로 로그인된 사용자 정보 가져오기
  // 반환 형식: "userid/username 님 환영합니다 | <a href='/auth/logout'>로그아웃</a>"
  var usermenu = authCheck.statusUI(req, res);
  var userid = usermenu.split('/')[0];    // 사용자 ID 추출
  var username = usermenu.split('/')[1].split(' ')[0];  // 사용자 이름 추출
  
  console.log('👤 메인 페이지 로드 - 사용자 ID:', userid, '이름:', username);
  
  // ====================================================================
  // HTML 페이지 생성 (Server-Side Rendering)
  // ====================================================================
  
  var html = `
  <!DOCTYPE html>
  <html lang="ko">
  <head>
    <!-- 기본 메타 태그 설정 -->
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FASHION STORE - 의류 쇼핑몰 상품 목록</title>
    
    <!-- 외부 스타일시트 연결 -->
    <link rel="stylesheet" href="/style.css">
  </head>

  <body>
    <!-- ====================================================================
         헤더 섹션: 로고, 네비게이션, 사용자 정보
         ================================================================== -->
    <header>
      <div class="container">
        <!-- 브랜드 로고 -->
        <div class="logo">FASHION STORE</div>
        
        <!-- 메인 네비게이션 메뉴 -->
        <nav>
          <ul>
            <li><a href="#" class="active">홈</a></li>
            <li><a href="#">신상품</a></li>
            <li><a href="#">베스트</a></li>
            <li><a href="#">세일</a></li>
            <li><a href="/mypage">마이페이지</a></li>
          </ul>
        </nav>
        
        <!-- 사용자 정보 및 기능 영역 -->
        <div class="header-right">
          <div class="user-info">
            <!-- 서버에서 전달받은 사용자명 동적 삽입 -->
            고객명: ${username} | <a href="/auth/logout" class="logout-btn">로그아웃</a>
          </div>
          <div class="cart-icon">
            <!-- 장바구니 페이지로 이동하는 링크 -->
            <a href="/cart">장바구니 보기</a>
          </div>
        </div>
      </div>
    </header>
    
    <!-- ====================================================================
         메인 콘텐츠 섹션: 상품 목록 표시 영역
         ================================================================== -->
    <main>
      <div class="container">
        <h1>의류 쇼핑몰 상품 목록</h1>
        
        <!-- 상품 그리드 컨테이너 (JavaScript에서 동적으로 채워짐) -->
        <div id="productGrid" class="product-grid">
          <!-- 초기 로딩 메시지 -->
          <div class="loading-message">
            <h3>상품을 불러오는 중입니다...</h3>
            <p>잠시만 기다려주세요.</p>
          </div>
        </div>
      </div>
    </main>

    <!-- ====================================================================
         푸터 섹션: 회사 정보, 링크, 뉴스레터
         ================================================================== -->
    <footer>
      <div class="container">
        <div class="footer-content">
          <!-- 브랜드 로고 (푸터용) -->
          <div>
            <div class="footer-logo">FASHION STORE</div>
          </div>
          
          <!-- 고객 서비스 링크 -->
          <div class="footer-links">
            <h4>고객 서비스</h4>
            <ul>
              <li><a href="#">주문 조회</a></li>
              <li><a href="#">배송 정책</a></li>
              <li><a href="#">반품 및 교환</a></li>
              <li><a href="#">FAQ</a></li>
            </ul>
          </div>
          
          <!-- 회사 정보 링크 -->
          <div class="footer-links">
            <h4>회사 정보</h4>
            <ul>
              <li><a href="#">회사 소개</a></li>
              <li><a href="#">이용약관</a></li>
              <li><a href="#">개인정보처리방침</a></li>
              <li><a href="#">제휴 문의</a></li>
            </ul>
          </div>
          
          <!-- 뉴스레터 구독 폼 -->
          <div class="footer-newsletter">
            <h4>뉴스레터 구독</h4>
            <p>최신 상품과 할인 정보를 받아보세요.</p>
            <form class="newsletter-form">
              <input type="email" placeholder="이메일 주소">
              <button type="submit">구독하기</button>
            </form>
          </div>
        </div>
        
        <!-- 저작권 정보 -->
        <div class="footer-bottom">
          <p>&copy; 2025 FASHION STORE. All rights reserved.</p>
        </div>
      </div>
    </footer>

    <!-- ====================================================================
         클라이언트 사이드 JavaScript (페이지 하단에 배치)
         ================================================================== -->
    <script>
      console.log('🚀 클라이언트 JavaScript 시작');
      
      /**
       * DOM 로드 완료 이벤트 리스너
       * ============================================================
       * 페이지의 모든 HTML 요소가 로드된 후 실행
       * 상품 데이터 로딩 프로세스 시작
       */
      document.addEventListener('DOMContentLoaded', function() {
        console.log('📄 DOM 로드 완료');
        
        // productGrid 요소 존재 확인
        var productGrid = document.getElementById('productGrid');
        console.log('🎯 productGrid 요소 찾기:', productGrid);
        
        if (!productGrid) {
          console.error('❌ productGrid 요소를 찾을 수 없습니다');
          return;
        }
        
        // 상품 데이터 가져오기 프로세스 시작
        fetchProducts();
      });
      
      /**
       * 서버에서 상품 데이터 가져오기 (비동기 함수)
       * ============================================================
       * 
       * 기능: /api/products API를 호출하여 상품 목록을 가져옴
       * 에러 처리: 네트워크 오류, HTTP 오류, 빈 데이터 등 처리
       * 
       * 처리 과정:
       * 1. fetch API로 GET /api/products 요청
       * 2. 응답 상태 확인 (200 OK 여부)
       * 3. JSON 파싱
       * 4. 데이터 유효성 검사
       * 5. displayProducts() 함수 호출
       */
      async function fetchProducts() {
        console.log('📡 상품 데이터 요청 시작');
        
        try {
          // 서버의 상품 목록 API 호출
          var response = await fetch('/api/products');
          console.log('📶 응답 상태:', response.status);
          
          // HTTP 상태 코드 확인 (200번대가 아니면 에러)
          if (!response.ok) {
            throw new Error("HTTP error! status:" + response.status);
          }
          
          // 응답을 JSON으로 파싱
          var products = await response.json();
          console.log('📦 받은 제품 데이터:', products);
          console.log('📊 제품 개수:', products.length);
          
          // 빈 데이터 처리
          if (products.length === 0) {
            document.getElementById('productGrid').innerHTML = 
              '<div class="loading-message"><h3>표시할 상품이 없습니다</h3></div>';
            return;
          }
          
          // 상품 표시 함수 호출
          displayProducts(products);
          
        } catch (error) {
          console.error('❌ 상품 로드 오류:', error);
          
          // 에러 발생 시 사용자에게 친화적인 메시지와 재시도 버튼 표시
          document.getElementById('productGrid').innerHTML = 
            '<div class="loading-message">' +
            '<h3>⚠️ 상품 로드 실패</h3>' +
            '<p>' + error.message + '</p>' +
            '<button onclick="fetchProducts()">다시 시도</button>' +
            '</div>';
        }
      }
      
      /**
       * 상품 카드 HTML 생성 함수
       * ============================================================
       * 
       * 기능: 개별 상품 데이터를 받아 HTML 카드 요소를 생성
       * 
       * @param {Object} product - 상품 데이터 객체
       * @returns {String} 완성된 상품 카드 HTML 문자열
       * 
       * 포함 요소:
       * - 상품 이미지 (에러 처리 포함)
       * - 상품 정보 (이름, 브랜드, 소재, 가격)
       * - 사이즈 선택 드롭다운
       * - 수량 입력 필드
       * - 장바구니 추가 버튼
       */
      function createProductCardHTML(product) {
        console.log('🏗️ 제품 카드 생성:', product.prod_name || product.pname);
        
        // 안전한 데이터 접근 (null/undefined 처리)
        var prodName = product.prod_name || product.pname || '제품명 없음';
        var prodImg = product.prod_img || 'no-image.jpg';
        var prodType = product.prod_type || '미등록';
        var material = product.material || '미등록';
        var price = product.price || 0;
        var prodCd = product.prod_cd || 'unknown';
        
        // prodImg가 URL인지 파일명인지 판별
        var isUrl = prodImg && (prodImg.startsWith('http://') || prodImg.startsWith('https://'));
        var imageSrc = isUrl ? prodImg : '/img/' + prodImg;
        
        console.log('🖼️ 이미지 타입:', isUrl ? 'URL' : '파일명', '- 경로:', imageSrc);
        
        // 상품 이미지 HTML 생성 (이미지 로딩 실패 시 대체 이미지 표시)
        var productImageHTML = '<div class="product-image">' +
              '<a href="/prod/product/' + prodCd + '" class="product-card">' +  // 상품 상세보기 링크
                  '<img src="' + imageSrc + '" ' +
                  'alt="' + prodName + '" ' +
                  'class="product-image" ' + 
                  'loading="lazy" ' +
                  'onerror="this.src=\\'/img/no-image.jpg\\';">' +
                '</a>' +
              '</div>';
              
        // 상품 정보 및 액션 버튼 HTML 생성
        var productInfoHTML = [
          '<div class="product-info">',
          '  <h3>' + prodName + '</h3>',
          '  <div class="product-meta">',
          '    <span class="brand">종류: ' + prodType + '</span>',
          '    <span class="material">소재: ' + material + '</span>',
          '  </div>',
          '  <div class="product-price">' + price.toLocaleString() + '원</div>',
          '  <div class="product-actions">',
          '    <div class="product-size">',
          '      <label for="size-' + prodCd + '">사이즈:</label>',
          '      <select id="size-' + prodCd + '" class="size-select">',
          '        <option value="S">소(S)</option>',
          '        <option value="M">중(M)</option>',
          '        <option value="L">대(L)</option>',
          '        <option value="XL">초대(XL)</option>',
          '        <option value="XXL">특대(XXL)</option>',
          '      </select>',
          '    </div>',
          '    <div class="product-quantity">',
          '      <label for="quantity-' + prodCd + '">수량:</label>',
          '      <input type="number" id="quantity-' + prodCd + '" class="quantity-input" value="1" min="1" max="10">',
          '    </div>',
          '    <button class="add-to-cart-btn" data-pcd="' + prodCd + '">장바구니에 추가</button>',
          '  </div>',
          '</div>'
        ].join('');
        
        // 이미지 + 정보 HTML 결합하여 반환
        return productImageHTML + productInfoHTML;
      }
      
      /**
       * 상품 목록 표시 함수
       * ============================================================
       * 
       * 기능: 상품 배열 데이터를 받아 화면에 카드 형태로 표시
       * 
       * @param {Array} products - 상품 데이터 배열
       * 
       * 처리 과정:
       * 1. 기존 productGrid 내용 초기화
       * 2. 각 상품에 대해 카드 요소 생성
       * 3. DOM에 카드 요소 추가
       * 4. 이벤트 리스너 등록
       */
      function displayProducts(products) {
        console.log('🖼️ 상품 표시 시작, 개수:', products.length);
        
        var productGrid = document.getElementById('productGrid');
        productGrid.innerHTML = ''; // 기존 내용 초기화 (로딩 메시지 제거)
        
        // 각 상품에 대해 카드 요소 생성 및 추가
        products.forEach(function(product, index) {
          try {
            // 새로운 상품 카드 div 요소 생성
            var productCard = document.createElement('div');
            productCard.className = 'product-card';
            
            // createProductCardHTML() 함수로 HTML 내용 생성
            productCard.innerHTML = createProductCardHTML(product);
            
            // productGrid에 카드 추가
            productGrid.appendChild(productCard);
            
            console.log('✅ 제품 카드 ' + (index + 1) + ' 추가 완료');
          } catch (error) {
            console.error('❌ 제품 카드 생성 오류:', error, product);
          }
        });
        
        console.log('🎉 모든 제품 카드 표시 완료');
        
        // 장바구니 버튼 이벤트 리스너 추가
        addCartEventListeners();
      }
      
      /**
       * 장바구니 버튼 이벤트 리스너 추가
       * ============================================================
       * 
       * 기능: 모든 "장바구니에 추가" 버튼에 클릭 이벤트 등록
       * 
       * 처리 과정:
       * 1. 모든 .add-to-cart-btn 요소 선택
       * 2. 각 버튼에 클릭 이벤트 리스너 등록
       * 3. 클릭 시 상품 정보 추출 및 addToCart() 호출
       */
      function addCartEventListeners() {
        var buttons = document.querySelectorAll('.add-to-cart-btn');
        console.log('🛒 장바구니 버튼 개수:', buttons.length);
        
        buttons.forEach(function(button) {
          button.addEventListener('click', function() {
            // 버튼의 data-pcd 속성에서 상품코드 추출
            var pcd = this.dataset.pcd;
            
            // 해당 상품의 사이즈와 수량 입력 요소 찾기
            var sizeElement = document.getElementById('size-' + pcd);
            var qtyElement = document.getElementById('quantity-' + pcd);
            
            // 선택된 값 추출 (요소가 없을 경우 기본값 사용)
            var size = sizeElement ? sizeElement.value : 'M';
            var qty = qtyElement ? qtyElement.value : 1;
            
            console.log('🛒 장바구니 추가 시도:', { pcd: pcd, size: size, qty: qty });
            
            // 장바구니 추가 함수 호출
            addToCart(pcd, size, qty);
          });
        });
      }
      
      /**
       * 장바구니에 상품 추가 함수 (비동기)
       * ============================================================
       * 
       * 기능: 선택된 상품을 서버의 장바구니 API에 전송하여 추가
       * 
       * @param {String} pcd - 상품코드
       * @param {String} size - 선택된 사이즈
       * @param {Number} qty - 선택된 수량
       * 
       * 처리 과정:
       * 1. POST /cart/add API 호출
       * 2. JSON 형태로 상품 정보 전송
       * 3. 서버 응답 처리
       * 4. 사용자에게 결과 알림
       */
      async function addToCart(pcd, size, qty) {
        console.log('🛒 addToCart 함수 호출:', { pcd: pcd, size: size, qty: qty });
        
        try {
          // 서버의 장바구니 추가 API 호출
          var response = await fetch('/cart/add', {
            method: 'POST',                               // HTTP POST 방식
            headers: {
              'Content-Type': 'application/json',        // JSON 데이터 전송 명시
            },
            body: JSON.stringify({                       // JavaScript 객체를 JSON 문자열로 변환
              pcd: pcd,
              size: size,
              qty: qty
            })
          });
      
          // HTTP 상태 코드 확인
          if (!response.ok) {
            throw new Error('HTTP error! status: ' + response.status);
          }
      
          // 서버 응답을 JSON으로 파싱
          var data = await response.json();
          console.log('✅ 서버 응답:', data);
          
          // 사용자에게 성공 알림
          alert('상품이 장바구니에 추가되었습니다!');
          
        } catch (error) {
          console.error('❌ 장바구니 추가 오류:', error);
          
          // 사용자에게 에러 알림
          alert('장바구니 추가 실패: ' + error.message);
        }
      }
      
      console.log('📝 클라이언트 JavaScript 로드 완료');

       // 상품 카드 클릭 시 부드러운 전환 효과
      document.querySelectorAll('.product-card').forEach(card => {
          card.addEventListener('click', function(e) {
              // 링크가 기본 동작을 하도록 하되, 로딩 효과 추가 가능
              console.log('상품 상세페이지로 이동:', this.href);
          });
      });

    </script>
  </body>
  </html>`;

  console.log('✅ HTML 생성 완료, 길이:', html.length, '문자');
  
  // 생성된 완전한 HTML 페이지를 클라이언트에 전송
  res.send(html);
  
  console.log('📤 HTML 페이지 전송 완료 - 사용자:', username);
});

// ====================================================================
// API 라우트 정의 (API Routes)
// ====================================================================

/**
 * 상품 목록 조회 API - GET /api/products
 * ================================================================
 * 
 * 기능: 데이터베이스에서 모든 상품 정보를 조회하여 JSON 형태로 반환
 * 
 * 응답 형식:
 * [
 *   {
 *     "prod_cd": "P001",
 *     "prod_name": "기본 티셔츠", 
 *     "prod_img": "tshirt.jpg",
 *     "prod_type": "상의",
 *     "material": "면 100%",
 *     "price": 29000
 *   },
 *   ...
 * ]
 * 
 * 에러 처리: 데이터베이스 연결 오류, 쿼리 실행 오류 등
 * ================================================================
 */
app.get('/api/products', async (req, res) => {
  console.log('🛍️ 상품 목록 API 요청 받음 - IP:', req.ip);
  
  try {
    // 데이터베이스에서 모든 상품 정보를 조회
    // db.query()는 Promise를 반환하므로 await 사용
    const [results] = await db.query('SELECT * FROM Products');
    
    console.log('📊 상품 조회 성공, 개수:', results.length);
    
    // 조회 결과를 JSON 형식으로 클라이언트에 응답
    res.json(results);
    
  } catch (err) {
    // 데이터베이스 오류 처리
    console.error('❌ 상품 조회 중 오류 발생:', err);
    
    // 클라이언트에 500 Internal Server Error와 에러 메시지 전송
    res.status(500).json({ 
      error: err.message,
      message: '상품 목록을 불러오는 중 오류가 발생했습니다'
    });
  }
});

/**
 * 장바구니에 상품 추가 API - POST /cart/add
 * ================================================================
 * 
 * 기능: 로그인한 사용자의 장바구니에 선택된 상품을 추가
 * 
 * 요청 본문:
 * {
 *   "pcd": "P001",        // 상품코드
 *   "size": "M",     // 선택된 사이즈
 *   "qty": 2              // 선택된 수량
 * }
 * 
 * 처리 과정:
 * 1. 요청 본문에서 상품 정보 추출
 * 2. 세션에서 사용자 정보 확인
 * 3. 데이터베이스 Carts 테이블에 정보 삽입
 * 4. 성공/실패 응답 전송
 * 
 * 보안: 로그인된 사용자만 접근 가능
 * ================================================================
 */
app.post('/cart/add', async (req, res) => {
  console.log('🛒 장바구니 추가 API 요청 받음 - IP:', req.ip);
  
  // 요청 본문에서 상품코드, 사이즈, 수량 추출
  const { pcd, size, qty } = req.body;
  
  console.log('📦 요청 데이터:', { pcd, size, qty });
  
  // 입력 데이터 유효성 검사
  if (!pcd || !size || !qty) {
    console.log('❌ 필수 데이터 누락');
    return res.status(400).json({ 
      message: "상품코드, 사이즈, 수량이 모두 필요합니다" 
    });
  }
  
  try {
    console.log('🔍 사용자 인증 확인 시작');
    
    // authCheck.statusUI()로 로그인된 사용자 정보 가져오기
    // 반환 형식: "userid/username 님 환영합니다 | ..."
    const userStatus = authCheck.statusUI(req, res);
    const userid = userStatus.split('/')[0];  // 첫 번째 '/' 전까지가 사용자 ID
    
    console.log('👤 인증된 사용자 ID:', userid);
    
    // 사용자 정보 존재 여부 확인
    if (!userid || userid === '로그인후') {
      console.log('❌ 인증되지 않은 사용자');
      return res.status(401).json({ message: "로그인이 필요합니다" });
    }
    
    console.log('💾 데이터베이스 삽입 시작');
    
    // 장바구니에 상품 추가 쿼리
    // Carts 테이블에 고객ID, 상품코드, 사이즈, 수량, 주문여부(기본값 'N') 저장
    const query = `
      INSERT INTO Carts(cust_id, prod_cd, prod_size, ord_qty, ord_yn) 
      VALUES (?, ?, ?, ?, 'N')
    `;
    
    console.log('🗃️ 실행할 쿼리:', query);
    console.log('📊 쿼리 파라미터:', [userid, pcd, size, qty]);
    
    // 파라미터화된 쿼리 실행 (SQL 인젝션 방지)
    const [results] = await db.query(query, [userid, pcd, size, qty]);
    
    console.log('✅ 데이터베이스 삽입 성공:', {
      insertId: results.insertId,
      affectedRows: results.affectedRows
    });
    
    // 성공 응답 전송
    res.json({ 
      message: 'Product added to cart',
      success: true,
      cartId: results.insertId
    });
    
    console.log('📤 장바구니 추가 성공 응답 전송 완료');
    
  } catch (error) {
    // 데이터베이스 오류 또는 기타 서버 오류 처리
    console.error('💥 장바구니 추가 중 오류 발생:', error);
    
    // 클라이언트에 500 Internal Server Error 전송
    res.status(500).json({ 
      error: error.message,
      message: '장바구니에 상품을 추가하는 중 오류가 발생했습니다',
      success: false
    });
  }
});

/**
 * ====================================================================
 * 애플리케이션 종료 시 정리 작업 (Graceful Shutdown)
 * ====================================================================
 */

// SIGINT 시그널 처리 (Ctrl+C)
process.on('SIGINT', () => {
  console.log('\n🛑 서버 종료 신호 받음 (SIGINT)');
  console.log('🧹 정리 작업 수행 중...');
  
  // 데이터베이스 연결 정리
  if (db && db.end) {
    db.end(() => {
      console.log('📡 데이터베이스 연결 종료 완료');
    });
  }
  
  console.log('👋 FASHION STORE 서버가 정상적으로 종료되었습니다');
  process.exit(0);
});

// 예기치 않은 오류 처리
process.on('uncaughtException', (error) => {
  console.error('💥 예기치 않은 오류 발생:', error);
  console.log('🔄 서버를 재시작해주세요');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 처리되지 않은 Promise 거부:', reason);
  console.error('🔍 Promise:', promise);
});

/**
 * ====================================================================
 * 모듈 시스템 정보 (참고용)
 * ====================================================================
 * 
 * 이 애플리케이션의 모듈 의존성:
 * 
 * Main.js (현재 파일)
 * ├── Express Framework
 * ├── 인증 모듈
 * │   ├── auth.js (라우터)
 * │   └── authCheck.js (유틸리티)
 * ├── 데이터 모듈
 * │   ├── db.js (데이터베이스)
 * │   └── cartView.js (장바구니 라우터)
 * └── 정적 파일
 *     ├── style.css (스타일시트)
 *     └── /img/* (상품 이미지)
 * 
 * 데이터베이스 테이블:
 * - Customers: 고객 정보
 * - Products: 상품 정보  
 * - Carts: 장바구니 (임시 저장)
 * - Orders: 주문 정보
 * - Order_items: 주문 상세
 * 
 * ====================================================================
 * 보안 고려사항
 * ====================================================================
 * 
 * 현재 적용된 보안 조치:
 * 1. 세션 기반 인증 시스템
 * 2. SQL 인젝션 방지 (파라미터화된 쿼리)
 * 3. XSS 방지 (httpOnly 쿠키)
 * 4. CSRF 방지 (SameSite 쿠키)
 * 5. 입력 데이터 검증
 * 
 * 추가 권장 보안 조치:
 * 1. HTTPS 적용 (운영환경)
 * 2. 환경변수 사용 (비밀키, DB 정보)
 * 3. Rate Limiting (API 호출 제한)
 * 4. Input Sanitization (입력값 정제)
 * 5. 에러 정보 노출 최소화
 * 
 * ====================================================================
 * 성능 최적화 방안
 * ====================================================================
 * 
 * 현재 적용된 최적화:
 * 1. 데이터베이스 연결 풀 사용
 * 2. 정적 파일 캐싱
 * 3. 지연 로딩 (이미지 lazy loading)
 * 4. 비동기 처리 (async/await)
 * 
 * 추가 최적화 방안:
 * 1. Redis 캐싱 시스템
 * 2. CDN 사용 (이미지, CSS)
 * 3. 데이터베이스 인덱싱
 * 4. API 응답 압축 (gzip)
 * 5. 이미지 최적화 (WebP 포맷)
 * 
 * ====================================================================
 */