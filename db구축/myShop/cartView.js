/**
 * ========================================================================
 * 장바구니 관리 모듈 (cartView.js) - MySQL 버전
 * ========================================================================
 * 
 * 기능:
 * - 장바구니 페이지 렌더링 (SSR)
 * - 장바구니 CRUD 작업 (조회, 수정, 삭제)
 * - 결제 처리
 * 
 * 주요 특징:
 * - 서버 사이드 렌더링(SSR)과 클라이언트 사이드 업데이트 혼합
 * - REST API 엔드포인트 제공
 * - 실시간 총액 계산
 * - 반응형 디자인 지원
 *
 * ========================================================================
 */

// 필수 모듈 import
const express = require('express');             // Express 웹 프레임워크
const router = express.Router();                // Express 라우터 인스턴스 생성
const db = require('./db.js');                  // 데이터베이스 연결 모듈
const cors = require('cors');                   // CORS 미들웨어
const authCheck = require('./authCheck.js');    // 사용자 인증 체크 모듈

// Express 애플리케이션 인스턴스 생성 및 CORS 설정
const app = express();
app.use(cors()); // 모든 Origin에서의 요청 허용

/**
 * 공통 함수: 사용자의 장바구니 데이터 조회
 * @param {string} userid - 사용자 ID
 * @returns {Array} 장바구니 아이템 배열
 * 
 * 설명: Customers, Carts, Products 테이블을 조인하여 주문되지 않은(ord_yn = 'N') 
 *       장바구니 아이템들의 상세 정보를 조회합니다.
 */
async function getCartItems(userid) {
  // Destructuring을 사용하여 쿼리 결과의 첫 번째 요소(실제 데이터) 추출
  const [cartItems] = await db.query(
    `SELECT ca.cart_seq_no, pr.prod_name, pr.price, pr.prod_img, ca.prod_size, ca.ord_qty 
     FROM Customers cu, Carts ca, Products pr 
     WHERE cu.cust_id = ?           -- 특정 사용자의 데이터만 조회
       AND ca.cust_id = cu.cust_id  -- 장바구니와 고객 정보 연결
       AND ca.prod_cd = pr.prod_cd  -- 장바구니와 상품 정보 연결
       AND ca.ord_yn = 'N'          -- 아직 주문하지 않은 아이템만 조회`,
    [userid] // SQL 인젝션 방지를 위한 파라미터 바인딩
  );
  return cartItems;
}

/**
 * 공통 함수: 장바구니 총액 계산
 * @param {Array} cartItems - 장바구니 아이템 배열
 * @returns {number} 총 금액
 * 
 * 설명: 각 상품의 가격과 수량을 곱한 값들을 모두 합산하여 총 금액을 계산합니다.
 */
function calculateTotal(cartItems) {
  // reduce 메서드로 각 아이템의 (가격 × 수량)을 누적 합산
  return cartItems.reduce((sum, item) => sum + (item.price * item.ord_qty), 0);
}

/**
 * 공통 함수: 장바구니 아이템들의 HTML 마크업 생성
 * @param {Array} cartItems - 장바구니 아이템 배열
 * @returns {string} 생성된 HTML 문자열
 * 
 * 설명: 서버 사이드 렌더링을 위해 장바구니 아이템들을 HTML로 변환합니다.
 *       빈 장바구니인 경우 적절한 안내 메시지를 표시합니다.
 */
function generateCartItemsHTML(cartItems) {
  // 빈 장바구니 처리
  if (cartItems.length === 0) {
    return `
      <div class="empty-cart">
        <h3>장바구니가 비어있습니다</h3>
        <p>상품을 추가해보세요!</p>
        <a href="/main" style="color: #3498db; text-decoration: none; font-weight: 500;">← 쇼핑 계속하기</a>
      </div>
    `;
  }

  // 각 장바구니 아이템을 HTML로 변환
  // map() 메서드로 배열의 각 요소를 HTML 문자열로 변환 후 join()으로 연결
  return cartItems.map(item => {
    const isUrl = item.prod_img && (item.prod_img.startsWith('http://') || item.prod_img.startsWith('https://'));
    const imageSrc = isUrl ? item.prod_img : '/img/' + item.prod_img;
    
    console.log('🖼️ [장바구니] 상품 이미지 처리:', {
        prodName: item.prod_name,
        isUrl: isUrl,
        finalSrc: imageSrc
    });

    return `
    <div class="cart-item">
      <!-- 상품 이미지 영역 -->
      <div class="cart-item-image">
        <img src="${imageSrc}" 
             alt="${item.prod_name}"                    <!-- 스크린 리더를 위한 대체 텍스트 -->
             loading="lazy"                             <!-- 성능 최적화: 지연 로딩 -->
             onerror="this.src='/img/no-image.jpg';">   <!-- 이미지 로드 실패 시 기본 이미지 표시 -->
      </div>
      
      <!-- 상품 정보 영역 -->
      <div class="cart-item-info">
        <h3>${item.prod_name}</h3>
        <!-- 가격 정보: 천 단위 구분 기호 추가로 가독성 향상 -->
        <div class="cart-item-price">가격: ${item.price.toLocaleString()}원</div>
        
        <!-- 상품 옵션 선택 영역 (사이즈, 수량) -->
        <div class="cart-item-options">
          <div class="cart-option-group">
            <label>사이즈:</label>
            <!-- 사이즈 선택 드롭다운 - 현재 선택된 사이즈에 selected 속성 동적 추가 -->
            <select class="size-select" data-id="${item.cart_seq_no}">
              <option value="S" ${item.prod_size === 'S' ? 'selected' : ''}>소(S)</option>
              <option value="M" ${item.prod_size === 'M' ? 'selected' : ''}>중(M)</option>
              <option value="L" ${item.prod_size === 'L' ? 'selected' : ''}>대(L)</option>
              <option value="XL" ${item.prod_size === 'XL' ? 'selected' : ''}>초대(XL)</option>
              <option value="XXL" ${item.prod_size === 'XXL' ? 'selected' : ''}>특대(XXL)</option>
            </select>
          </div>
          
          <div class="cart-option-group">
            <label>수량:</label>
            <!-- 수량 선택 입력 필드 - 최소/최대값 제한 포함 -->
            <input type="number" class="quantity-input" data-id="${item.cart_seq_no}" 
                   value="${item.ord_qty}" min="1" max="10">
          </div>
        </div>
        
        <!-- 삭제 버튼 - 장바구니에서 아이템 제거 -->
        <button class="remove-item" data-id="${item.cart_seq_no}">삭제</button>
      </div>
    </div>
  `}).join(''); // 배열의 모든 HTML 문자열을 하나로 연결
}

/**
 * 메인 장바구니 페이지 라우터 (GET /)
 * 서버 사이드 렌더링(SSR)을 통해 완전한 HTML 페이지를 생성하여 응답합니다.
 * 
 * 처리 과정:
 * 1. 사용자 인증 정보 확인
 * 2. 장바구니 데이터 조회
 * 3. 총액 계산
 * 4. 완전한 HTML 페이지 생성 (헤더, 아이템 목록, JavaScript 포함)
 * 5. 클라이언트에 응답
 */
router.get('/', async (req, res) => {
  try {
    // 사용자 인증 정보 추출 (authCheck 모듈에서 'userid/username' 형태로 반환)
    const userid = authCheck.statusUI(req, res).split('/')[0];
    const username = authCheck.statusUI(req, res).split('/')[1];
    
    // 장바구니 데이터 조회 및 총액 계산
    const cartItems = await getCartItems(userid);
    const totalAmount = calculateTotal(cartItems);
    
    // 서버 로그: 장바구니 페이지 로드 상황 기록
    console.log(`[SSR] 장바구니 페이지 로드 - 사용자: ${username}, 아이템: ${cartItems.length}개, 총액: ${totalAmount.toLocaleString()}원`);
    
    // 완전한 HTML 페이지 생성 (SSR 방식)
    const html = `
    <html lang="ko">
    <head>
        <!-- 기본 메타 정보 -->
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>FASHION STORE - 장바구니</title>
        <!-- 외부 CSS 파일 링크 -->
        <link rel="stylesheet" href="/style.css">
    </head>
    <body>
        <div class="cart-container">
            <!-- 장바구니 헤더 - 좌우 분할 레이아웃 -->
            <div class="cart-header">
                <!-- 왼쪽: 장바구니 제목 및 사용자 정보 -->
                <div class="cart-header-left">
                    <h1>장바구니</h1>
                    <h2>회원명: ${username}</h2>
                </div>
                
                <!-- 오른쪽: 총액 표시 및 결제 버튼 (조건부 렌더링) -->
                ${cartItems.length > 0 ? `
                    <div class="cart-header-right">
                        <!-- 헤더에 총액 표시 -->
                        <div class="cart-total-header">총 금액: <span id="totalAmountHeader">${totalAmount.toLocaleString()}</span>원</div>
                        <!-- 헤더에 결제 버튼 배치 -->
                        <button id="paymentButtonHeader" class="payment-button-header">결제하기</button>
                    </div>
                ` : `
                    <!-- 빈 장바구니일 때 표시할 메시지 -->
                    <div class="cart-header-right">
                        <div style="color: rgba(255,255,255,0.7); font-size: 1.1rem;">장바구니가 비어있습니다</div>
                    </div>
                `}
            </div>
            
            <!-- 장바구니 아이템 컨테이너 (동적 업데이트 대상) -->
            <div id="cartItems">
                ${generateCartItemsHTML(cartItems)}
            </div>
        </div>

        <!-- 클라이언트 사이드 JavaScript -->
        <script>
            // JavaScript 시작 로그
            console.log('장바구니 JavaScript 시작');
            
            /**
             * AJAX를 통한 장바구니 아이템 조회
             * 동적 업데이트를 위해 서버에서 최신 장바구니 데이터를 가져옵니다.
             * 
             * 사용 시나리오:
             * - 아이템 수정/삭제 후 화면 새로고침
             * - 실시간 데이터 동기화 필요 시
             * - 서버 렌더링 데이터가 없을 때 초기 로드
             */
            async function fetchCartItems() {
                console.log('[AJAX] 장바구니 데이터 요청 시작');
                try {
                    // REST API 엔드포인트로 JSON 데이터 요청
                    const response = await fetch('/cart/api/items');
                    
                    // HTTP 응답 상태 확인
                    if (!response.ok) {
                        throw new Error("HTTP error! status:" + response.status);
                    }
                    
                    // JSON 파싱 및 데이터 추출
                    const data = await response.json();
                    console.log('[AJAX] 받은 장바구니 데이터:', data);
                    
                    // 화면에 데이터 표시
                    displayCartItems(data.items, data.total);
                } catch (error) {
                    // 네트워크 오류 또는 서버 오류 처리
                    console.error('장바구니 아이템을 가져오는 중 오류 발생:', error);
                    showError();
                }
            }
            
            /**
             * 장바구니 아이템 동적 표시
             * @param {Array} items - 장바구니 아이템 배열
             * @param {number} total - 총 금액
             * 
             * 설명: AJAX로 받은 데이터를 기반으로 화면을 동적으로 업데이트합니다.
             *       빈 장바구니와 아이템이 있는 경우를 구분하여 처리합니다.
             * 
             * 처리 과정:
             * 1. DOM 요소 참조 획득
             * 2. 빈 장바구니 체크 및 처리
             * 3. 아이템 HTML 동적 생성
             * 4. 헤더 영역 업데이트
             * 5. 이벤트 리스너 재등록
             */
            function displayCartItems(items, total) {
                console.log('장바구니 아이템 표시 시작', '개수:', items.length);
                
                // 주요 DOM 요소 참조
                const cartItemsContainer = document.getElementById('cartItems');
                const headerRight = document.querySelector('.cart-header-right');
                
                // 빈 장바구니 처리
                if (items.length === 0) {
                    // 빈 장바구니 메시지 HTML 생성 (문자열 연결 방식)
                    cartItemsContainer.innerHTML = 
                        '<div class="empty-cart">' +
                        '<h3>장바구니가 비어있습니다</h3>' +
                        '<p>상품을 추가해보세요!</p>' +
                        '<a href="/main">← 쇼핑 계속하기</a>' +
                        '</div>';
                    
                    // 헤더 오른쪽을 빈 장바구니 메시지로 변경
                    if (headerRight) {
                        headerRight.innerHTML = '<div style="color: rgba(255,255,255,0.7); font-size: 1.1rem;">장바구니가 비어있습니다</div>';
                    }
                    return; // 함수 종료
                }

                // 동적으로 HTML 생성 (서버와 동일한 구조 유지)
                // map() 메서드로 각 아이템을 HTML 문자열로 변환
                cartItemsContainer.innerHTML = items.map(item => {
                    const isUrl = item.prod_img && (item.prod_img.startsWith('http://') || item.prod_img.startsWith('https://'));
                    const imageSrc = isUrl ? item.prod_img : '/img/' + item.prod_img;
                    
                    return '<div class="cart-item">' +
                        // 상품 이미지 영역
                        '<div class="cart-item-image">' +
                            '<img src="' + imageSrc + '" alt="' + item.prod_name + '" ' +
                            'loading="lazy" onerror="this.src=\\'/img/no-image.jpg\\';">' + // 이미지 로드 실패 시 기본 이미지
                        '</div>' +
                        // 상품 정보 영역
                        '<div class="cart-item-info">' +
                            '<h3>' + item.prod_name + '</h3>' +
                            '<div class="cart-item-price">가격: ' + item.price.toLocaleString() + '원</div>' + // 천 단위 구분 기호
                            // 상품 옵션 선택 영역
                            '<div class="cart-item-options">' +
                                // 사이즈 선택 드롭다운
                                '<div class="cart-option-group">' +
                                    '<label>사이즈:</label>' +
                                    '<select class="size-select" data-id="' + item.cart_seq_no + '">' +
                                        '<option value="S"' + (item.prod_size === 'S' ? ' selected' : '') + '>소(S)</option>' +
                                        '<option value="M"' + (item.prod_size === 'M' ? ' selected' : '') + '>중(M)</option>' +
                                        '<option value="L"' + (item.prod_size === 'L' ? ' selected' : '') + '>대(L)</option>' +
                                        '<option value="XL"' + (item.prod_size === 'XL' ? ' selected' : '') + '>초대(XL)</option>' +
                                        '<option value="XXL"' + (item.prod_size === 'XXL' ? ' selected' : '') + '>특대(XXL)</option>' +
                                    '</select>' +
                                '</div>' +
                                // 수량 입력 필드
                                '<div class="cart-option-group">' +
                                    '<label>수량:</label>' +
                                    '<input type="number" class="quantity-input" data-id="' + item.cart_seq_no + '" ' +
                                    'value="' + item.ord_qty + '" min="1" max="10">' + // 수량 제한
                                '</div>' +
                            '</div>' +
                            // 삭제 버튼
                            '<button class="remove-item" data-id="' + item.cart_seq_no + '">삭제</button>' +
                        '</div>' +
                    '</div>';
                }).join(''); // 배열의 모든 HTML 문자열을 하나로 연결

                // 헤더에 총액과 결제 버튼 표시 (아이템이 있을 때)
                if (headerRight) {
                    headerRight.innerHTML = 
                        '<div class="cart-total-header">총 금액: <span id="totalAmountHeader">' + total.toLocaleString() + '</span>원</div>' +
                        '<button id="paymentButtonHeader" class="payment-button-header">결제하기</button>';
                }

                // 총액 업데이트 및 이벤트 리스너 재등록
                updateTotalAmount(total);
                addEventListeners();
                
                console.log('장바구니 아이템 표시 완료');
            }

            /**
             * 총 금액 업데이트
             * @param {number} total - 업데이트할 총 금액
             * 
             * 설명: 헤더와 기존 위치의 총액 표시를 모두 업데이트합니다.
             *       하위 호환성을 위해 두 위치 모두 처리합니다.
             * 
             * 업데이트 대상:
             * - totalAmountHeader: 헤더의 총액 표시
             * - totalAmount: 기존 위치의 총액 표시 (레거시)
             */
            function updateTotalAmount(total) {
                // 헤더의 총액 업데이트
                const totalElementHeader = document.getElementById('totalAmountHeader');
                if (totalElementHeader) {
                    totalElementHeader.textContent = total.toLocaleString();
                    console.log('헤더 총 금액 업데이트:', total.toLocaleString() + '원');
                }
                
                // 기존 위치의 총액도 업데이트 (하위 호환성)
                const totalElement = document.getElementById('totalAmount');
                if (totalElement) {
                    totalElement.textContent = total.toLocaleString();
                }
            }

            /**
             * 실시간 총액 계산
             * 사용자가 수량을 변경할 때 서버 요청 없이 즉시 총액을 재계산합니다.
             * 
             * 설명: DOM에서 현재 표시된 가격과 수량 정보를 읽어 총액을 계산하고 
             *       화면에 즉시 반영하여 사용자 경험을 향상시킵니다.
             * 
             * 계산 과정:
             * 1. 모든 장바구니 아이템 순회
             * 2. 각 아이템의 가격과 수량 추출
             * 3. 개별 총액 계산 (가격 × 수량)
             * 4. 전체 총액 합산
             * 5. 화면에 업데이트
             */
            function calculateAndUpdateTotal() {
                let total = 0;
                
                // 모든 장바구니 아이템을 순회하며 총액 계산
                document.querySelectorAll('.cart-item').forEach(item => {
                    // 가격 텍스트에서 숫자만 추출 ('가격: 10,000원' → 10000)
                    const priceText = item.querySelector('.cart-item-price').textContent;
                    const price = parseInt(priceText.match(/[\\d,]+/)[0].replace(/,/g, ''));
                    
                    // 수량 입력 필드에서 현재 값 추출
                    const quantity = parseInt(item.querySelector('.quantity-input').value);
                    
                    // 개별 아이템 총액을 전체 총액에 누적
                    total += price * quantity;
                });
                
                // 계산된 총액을 화면에 업데이트
                updateTotalAmount(total);
            }

            /**
             * 오류 상황 표시
             * 장바구니 데이터를 불러오는 중 오류가 발생했을 때 사용자에게 알립니다.
             * 
             * 표시 내용:
             * - 오류 메시지
             * - 다시 시도 버튼 (fetchCartItems 재호출)
             * 
             * 사용 시나리오:
             * - 네트워크 연결 오류
             * - 서버 내부 오류
             * - API 엔드포인트 오류
             */
            function showError() {
                // 오류 메시지 HTML 생성 (문자열 연결 방식으로 안전성 확보)
                document.getElementById('cartItems').innerHTML = 
                    '<div class="empty-cart"><h3>장바구니를 불러오는 중 오류가 발생했습니다</h3>' +
                    '<button onclick="fetchCartItems()">다시 시도</button></div>';
            }

            /**
             * 이벤트 리스너 등록
             * 
             * 설명: 장바구니 아이템들에 대한 모든 상호작용 이벤트를 등록합니다.
             *       동적으로 생성된 HTML 요소들에 이벤트를 바인딩합니다.
             * 
             * 등록되는 이벤트:
             * - 수량 변경: 서버 업데이트 + 실시간 총액 계산
             * - 사이즈 변경: 서버 업데이트
             * - 삭제 버튼: 확인 후 삭제
             * - 결제 버튼: 확인 후 결제 처리
             * 
             * 주의사항:
             * - 기존 이벤트 리스너 중복 등록 방지
             * - 동적 생성 요소에 대한 이벤트 위임 처리
             */
            function addEventListeners() {
                // 수량 변경 이벤트 (서버 업데이트)
                document.querySelectorAll('.quantity-input').forEach(input => {
                    // change 이벤트: 사용자가 수량을 확정했을 때 서버에 업데이트
                    input.addEventListener('change', async function() {
                        const id = this.dataset.id;           // 장바구니 아이템 ID
                        const newQuantity = this.value;       // 새로운 수량
                        console.log('수량 변경 (서버 업데이트):', { id, newQuantity });
                        await updateCartItem(id, { quantity: newQuantity });
                    });
                    
                    // input 이벤트: 사용자가 타이핑하는 동안 실시간 총액 업데이트
                    input.addEventListener('input', calculateAndUpdateTotal);
                });
            
                // 사이즈 변경 이벤트
                document.querySelectorAll('.size-select').forEach(select => {
                    select.addEventListener('change', async function() {
                        const id = this.dataset.id;       // 장바구니 아이템 ID
                        const newSize = this.value;       // 새로운 사이즈
                        console.log('사이즈 변경:', { id, newSize });
                        await updateCartItem(id, { size: newSize });
                    });
                });
            
                // 삭제 버튼 이벤트
                document.querySelectorAll('.remove-item').forEach(button => {
                    button.addEventListener('click', async function() {
                        const id = this.dataset.id;
                        console.log('상품 삭제:', { id });
                        
                        // 사용자 확인 후 삭제 진행
                        if (confirm('이 상품을 장바구니에서 삭제하시겠습니까?')) {
                            await removeCartItem(id);
                        }
                    });
                });
            
                // 결제 버튼 이벤트 (헤더의 버튼)
                const paymentButtonHeader = document.getElementById('paymentButtonHeader');
                if (paymentButtonHeader) {
                    // 기존 이벤트 리스너 제거 (중복 방지)
                    paymentButtonHeader.removeEventListener('click', processPayment);
                    paymentButtonHeader.addEventListener('click', async function() {
                        console.log('결제 처리 시작');
                        
                        // 사용자 확인 후 결제 진행
                        if (confirm('결제를 진행하시겠습니까?')) {
                            await processPayment();
                        }
                    });
                }
            }
            
            /**
             * 장바구니 아이템 업데이트 (사이즈, 수량)
             * @param {string} id - 장바구니 아이템 ID (cart_seq_no)
             * @param {Object} updates - 업데이트할 정보 (size, quantity)
             * 
             * 설명: 서버에 PUT 요청을 보내 장바구니 아이템을 업데이트하고 
             *       성공 시 화면을 새로고침합니다.
             * 
             * 처리 과정:
             * 1. REST API PUT 요청 전송
             * 2. JSON 형태로 업데이트 데이터 전송
             * 3. 응답 상태 확인
             * 4. 성공 시 장바구니 데이터 새로고침
             * 5. 실패 시 사용자에게 오류 알림
             */
            async function updateCartItem(id, updates) {
                try {
                    // 서버에 PUT 요청으로 아이템 업데이트
                    const response = await fetch('/cart/' + id, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },  // JSON 데이터 전송 명시
                        body: JSON.stringify(updates)                     // 업데이트 데이터를 JSON 문자열로 변환
                    });
                    
                    // HTTP 응답 상태 확인
                    if (!response.ok) throw new Error('Failed to update cart item');
                    
                    console.log('장바구니가 업데이트되었습니다. id:', id);
                    await fetchCartItems(); // 최신 데이터로 화면 새로고침
                } catch (error) {
                    // 오류 처리: 콘솔 로그 + 사용자 알림
                    console.error('Cart update error:', error);
                    alert('장바구니 업데이트에 실패했습니다.');
                }
            }
          
            /**
             * 장바구니 아이템 삭제
             * @param {string} id - 삭제할 장바구니 아이템 ID (cart_seq_no)
             * 
             * 설명: 서버에 DELETE 요청을 보내 해당 아이템을 삭제하고 
             *       성공 시 화면을 새로고침합니다.
             * 
             * 주의사항:
             * - 물리적 삭제 (복구 불가능)
             * - 사용자 확인 과정이 선행되어야 함
             * - 삭제 후 자동으로 최신 데이터로 갱신
             */
            async function removeCartItem(id) {
                try {
                    // 서버에 DELETE 요청으로 아이템 삭제
                    const response = await fetch('/cart/' + id, { method: 'DELETE' });
                    
                    // HTTP 응답 상태 확인
                    if (!response.ok) throw new Error('Failed to remove cart item');
                    
                    console.log('장바구니 상품이 삭제되었습니다. id:', id);
                    await fetchCartItems(); // 삭제 후 최신 데이터로 화면 새로고침
                } catch (error) {
                    // 오류 처리: 콘솔 로그 + 사용자 알림
                    console.error('Cart removal error:', error);
                    alert('상품 삭제에 실패했습니다.');
                }
            }
            
            /**
             * 결제 처리
             * 
             * 설명: 서버에 POST 요청을 보내 현재 장바구니의 모든 아이템을
             *       주문으로 변환하고 장바구니를 비웁니다.
             * 
             * 처리 과정:
             * 1. 서버의 결제 API 호출 (/cart/pay)
             * 2. 장바구니 → 주문 데이터 변환
             * 3. 결제 완료 메시지 표시
             * 4. 장바구니 비우기 (화면 새로고침)
             * 
             * 주의사항:
             * - 실제 결제 게이트웨이 연동 없이 DB 처리만
             * - 트랜잭션 처리로 데이터 일관성 보장 필요
             */
            async function processPayment() {
                try {
                    // 서버에 결제 처리 요청
                    const response = await fetch('/cart/pay', { 
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }  // JSON 요청 타입 명시
                    });
                    
                    // HTTP 응답 상태 확인
                    if (!response.ok) throw new Error('Failed to process payment');
                    
                    // 서버 응답을 JSON으로 파싱
                    const result = await response.json();
                    
                    // 결제 완료 메시지 표시
                    alert('결제 완료: ' + result.message);
                    
                    // 결제 후 장바구니 상태 새로고침 (빈 장바구니 표시)
                    await fetchCartItems();
                } catch (error) {
                    // 결제 오류 처리: 콘솔 로그 + 사용자 알림
                    console.error('Payment error:', error);
                    alert('결제 처리에 실패했습니다.');
                }
            }
          
            /**
             * 페이지 초기화
             * 
             * 설명: DOM 로드 완료 시 실행되며, 서버에서 렌더링된 데이터가 있는지 확인하고 
             *       적절한 초기화 방법을 선택합니다.
             * 
             * 초기화 전략 (하이브리드 렌더링):
             * - 서버 데이터 있음: 이벤트 리스너만 등록 (SSR 활용)
             * - 서버 데이터 없음: AJAX로 데이터 요청 (CSR 방식)
             * 
             * 장점:
             * - 빠른 초기 로딩 (SSR)
             * - 동적 업데이트 지원 (CSR)
             * - SEO 친화적
             */
            document.addEventListener('DOMContentLoaded', function() {
                console.log('DOM 로드 완료');
                
                // 서버에서 렌더링된 장바구니 아이템 확인
                const existingItems = document.querySelectorAll('.cart-item');
                
                if (existingItems.length > 0) {
                    // 서버 사이드 렌더링된 데이터가 있는 경우
                    console.log('서버 렌더링된 장바구니 아이템 발견:', existingItems.length + '개');
                    
                    // 기존 HTML 요소들에 이벤트 리스너 등록
                    addEventListeners();
                    
                    // 실시간 총액 업데이트를 위한 추가 이벤트 등록
                    document.querySelectorAll('.quantity-input').forEach(input => {
                        input.addEventListener('input', calculateAndUpdateTotal);
                    });
                } else {
                    // 서버에서 렌더링된 데이터가 없는 경우
                    console.log('서버 데이터 없음, AJAX로 데이터 요청');
                    
                    // AJAX를 통해 장바구니 데이터를 가져와서 동적 렌더링
                    fetchCartItems();
                }
            });
            
            // JavaScript 로드 완료 로그
            console.log('장바구니 JavaScript 로드 완료');
        </script>
    </body>
    </html>
    `;
    
    // 생성된 HTML 페이지를 클라이언트에 전송
    res.send(html);
  } catch (error) {
    // 서버 사이드 렌더링 중 오류 발생 시 처리
    console.error('장바구니 페이지 로드 오류:', error);
    
    // HTTP 500 상태 코드와 함께 오류 메시지 반환
    res.status(500).send('서버 오류가 발생했습니다.');
  }
});

/**
 * API 엔드포인트: 장바구니 데이터 조회 (GET /api/items)
 * AJAX 요청 전용으로 장바구니 데이터를 JSON 형태로 반환합니다.
 * 
 * 용도:
 * - 클라이언트 사이드 렌더링 (CSR) 지원
 * - 동적 데이터 업데이트 시 사용
 * - SPA(Single Page Application) 환경에서 활용
 * 
 * 응답 형식:
 * {
 *   items: Array,    // 장바구니 아이템 배열
 *   total: number,   // 총 금액
 *   count: number    // 아이템 개수
 * }
 */
router.get('/api/items', async (req, res) => {
  try {
    // 사용자 인증 정보 추출 (authCheck 미들웨어를 통한 세션 검증)
    const userid = authCheck.statusUI(req, res).split('/')[0];
    
    // 장바구니 데이터 조회 및 총액 계산
    const cartItems = await getCartItems(userid);
    const totalAmount = calculateTotal(cartItems);
    
    // API 요청 로그 (디버깅 및 모니터링 목적)
    console.log(`[API] 장바구니 데이터 요청 - 사용자: ${userid}, 아이템: ${cartItems.length}개, 총액: ${totalAmount.toLocaleString()}원`);
    
    // JSON 응답 (구조화된 데이터 반환)
    res.json({
      items: cartItems,         // 상품 상세 정보 배열 (이미지, 이름, 가격, 사이즈, 수량 등)
      total: totalAmount,       // 계산된 총 금액 (price × quantity의 합)
      count: cartItems.length   // 장바구니에 담긴 아이템 개수
    });
  } catch (error) {
    // API 오류 처리 (JSON 형태로 일관된 오류 응답)
    console.error('장바구니 API 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * API 엔드포인트: 장바구니 아이템 업데이트 (PUT /:id)
 * 특정 장바구니 아이템의 사이즈나 수량을 업데이트합니다.
 * 
 * REST API 설계 원칙:
 * - PUT 메서드: 리소스의 부분 업데이트 (PATCH와 유사하게 사용)
 * - URL 파라미터로 대상 아이템 식별
 * - 요청 본문으로 변경할 데이터 전송
 * 
 * 파라미터:
 * - id: 장바구니 아이템 ID (cart_seq_no) - URL 경로에 포함
 * 
 * 요청 본문 (JSON):
 * - size: 변경할 사이즈 (선택사항) - "S", "M", "L", "XL", "XXL"
 * - quantity: 변경할 수량 (선택사항) - 1~10 범위의 정수
 * 
 * 특징:
 * - 부분 업데이트 지원 (size만 또는 quantity만 변경 가능)
 * - MySQL 트랜잭션으로 데이터 일관성 보장
 */
router.put('/:id', async (req, res) => {
  let connection;
  
  try {
    // 데이터베이스 연결 풀에서 연결 획득
    connection = await db.getConnection();
    
    // 트랜잭션 시작
    await connection.beginTransaction();
    
    // URL 파라미터에서 업데이트할 아이템 ID 추출
    const { id } = req.params;
    
    // 요청 본문에서 업데이트할 필드들 추출 (구조 분해 할당)
    const { size, quantity } = req.body;
    
    // 업데이트 요청 로그 (디버깅 목적)
    console.log('장바구니 업데이트 요청:', { id, size, quantity });
    
    // 사이즈 업데이트 (요청된 경우만 실행)
    if (size) {
        // Prepared Statement 방식으로 SQL 인젝션 방지
        await connection.query('UPDATE Carts SET prod_size = ? WHERE cart_seq_no = ?', [size, id]);
        console.log('사이즈 업데이트 완료:', size);
    }
    
    // 수량 업데이트 (요청된 경우만 실행)
    if (quantity) {
        // Prepared Statement 방식으로 SQL 인젝션 방지
        await connection.query('UPDATE Carts SET ord_qty = ? WHERE cart_seq_no = ?', [quantity, id]);
        console.log('수량 업데이트 완료:', quantity);
    }
    
    // 트랜잭션 커밋
    await connection.commit();
    
    // 성공 응답 (클라이언트에서 success 플래그로 결과 판단)
    res.json({ message: '장바구니가 업데이트되었습니다.', success: true });
  } catch (error) {
    // 오류 발생 시 롤백
    if (connection) {
      await connection.rollback();
    }
    
    // 데이터베이스 오류 또는 기타 서버 오류 처리
    console.error('장바구니 업데이트 오류:', error);
    
    // HTTP 500 상태 코드와 함께 JSON 오류 응답
    res.status(500).json({ error: '서버 오류가 발생했습니다.', success: false });
  } finally {
    // 연결 반환
    if (connection) {
      connection.release();
    }
  }
});

/**
 * API 엔드포인트: 장바구니 아이템 삭제 (DELETE /:id)
 * 특정 장바구니 아이템을 완전히 삭제합니다.
 * 
 * REST API 설계 원칙:
 * - DELETE 메서드: 리소스의 완전 삭제
 * - 멱등성 보장 (같은 요청을 여러 번 해도 결과 동일)
 * - URL 파라미터로 삭제 대상 식별
 * 
 * 파라미터:
 * - id: 삭제할 장바구니 아이템 ID (cart_seq_no)
 * 
 * 주의사항:
 * - 물리적 삭제 (Hard Delete) 방식
 * - 복구 불가능한 작업
 * - 사용자 확인 과정이 클라이언트에서 선행되어야 함
 * - 관련 데이터 정합성 확인 필요
 */
router.delete('/:id', async (req, res) => {
  try {
    // URL 파라미터에서 삭제할 아이템 ID 추출
    const { id } = req.params;
    
    // 삭제 요청 로그 (감사 추적 목적)
    console.log('장바구니 삭제 요청:', id);
    
    // 데이터베이스에서 해당 아이템 물리적 삭제
    // WHERE 조건으로 특정 아이템만 삭제 (안전성 확보)
    await db.query('DELETE FROM Carts WHERE cart_seq_no = ?', [id]);
    
    // 삭제 완료 로그
    console.log('장바구니 삭제 완료:', id);
    
    // 삭제 성공 응답
    res.json({ message: '상품이 장바구니에서 삭제되었습니다.', success: true });
  } catch (error) {
    // 데이터베이스 제약 조건 위반 또는 기타 오류 처리
    // 예: 외래키 제약 조건, 존재하지 않는 ID 등
    console.error('장바구니 삭제 오류:', error);
    
    // HTTP 500 상태 코드와 함께 JSON 오류 응답
    res.status(500).json({ error: '서버 오류가 발생했습니다.', success: false });
  }
});

/**
 * API 엔드포인트: 결제 처리 (POST /pay)
 * 현재 장바구니의 모든 아이템을 주문으로 변환하고 결제를 처리합니다.
 * 
 * 비즈니스 로직:
 * - 장바구니 → 주문 데이터 변환
 * - 주문 마스터 및 상세 정보 생성
 * - 장바구니 상태 변경 (주문 완료 표시)
 * 
 * 처리 과정 (3단계):
 * 1. Orders 테이블에 주문 정보 삽입 (사용자, 날짜, 총 금액)
 * 2. Ord_items 테이블에 주문 상세 정보 삽입 (각 상품별 정보)
 * 3. Carts 테이블의 주문 상태 업데이트 (ord_yn = 'Y'로 변경)
 * 
 * 데이터베이스 설계:
 * - Orders: 주문 헤더 테이블 (1:N 관계의 부모)
 * - Ord_items: 주문 상세 테이블 (1:N 관계의 자식)
 * - Carts: 장바구니 테이블 (소프트 삭제 방식으로 이력 유지)
 */
router.post('/pay', async (req, res) => {
  // 사용자 인증 정보 추출 (ID와 이름 분리)
  const userid = authCheck.statusUI(req, res).split('/')[0];
  const username = authCheck.statusUI(req, res).split('/')[1];

  // 결제 처리 시작 로그
  console.log('결제 처리 시작 - 사용자:', username);

  let connection;

  try {
    // 데이터베이스 연결 풀에서 연결 획득
    connection = await db.getConnection();
    
    // 트랜잭션 시작 (데이터 일관성 보장)
    await connection.beginTransaction();
    
    // 1단계: Orders 테이블에 주문 정보 삽입
    // 복잡한 집계 쿼리를 통해 장바구니 총액을 계산하여 주문 생성
    const query_1 = `INSERT INTO Orders (cust_id, ord_date, ord_amount) 
                     SELECT cu.cust_id, date(now()), sum(pr.price * ca.ord_qty) 
                     FROM Customers cu, Carts ca, Products pr 
                     WHERE cu.cust_id = ? AND cu.cust_id = ca.cust_id AND ca.prod_cd = pr.prod_cd AND ca.ord_yn = 'N'`;

    /*
     * 쿼리 분석:
     * - SELECT 절: 고객ID, 현재날짜, 총금액(가격×수량의 합)
     * - FROM 절: 3개 테이블 조인 (고객, 장바구니, 상품)
     * - WHERE 절: 특정 사용자 + 아직 주문하지 않은 아이템만
     * - GROUP BY: 사용자별로 그룹화하여 총액 계산
     */
    await connection.query(query_1, [userid]);
    console.log('Orders 테이블 삽입 완료');
    
    // 2단계: Ord_items 테이블에 주문 상세 정보 삽입
    // 서브쿼리를 통해 방금 생성된 주문번호를 찾아 상세 정보 연결
    const query_2 = `INSERT INTO Ord_items (ord_no, cart_seq_no, prod_cd, prod_size, ord_qty) 
                     SELECT x.ord_no, ca.cart_seq_no, ca.prod_cd, ca.prod_size, ca.ord_qty 
                     FROM (SELECT od.cust_id, max(od.ord_no) ord_no 
                           FROM Customers cu, Orders od 
                           WHERE cu.cust_id = ? and cu.cust_id = od.cust_id 
                           GROUP BY od.cust_id) x, 
                          Carts ca 
                     WHERE x.cust_id = ca.cust_id AND ca.ord_yn = 'N'`;
    /*
     * 쿼리 분석:
     * - 서브쿼리 x: 해당 사용자의 가장 최신 주문번호 조회 (MAX 함수 사용)
     * - 메인 쿼리: 장바구니의 모든 아이템을 주문 상세로 복사
     * - 조인 조건: 사용자 일치 + 미주문 아이템만
     */
    await connection.query(query_2, [userid]);
    console.log('Ord_items 테이블 삽입 완료');

    // 3단계: Carts 테이블의 주문 상태 업데이트
    // 소프트 삭제 방식으로 주문 완료 표시 (이력 유지)
    const query_3 = `UPDATE Carts 
                     SET ord_yn = 'Y' 
                     WHERE cust_id = ? AND ord_yn = 'N'`;
    /*
     * 쿼리 분석:
     * - UPDATE 대상: 특정 사용자의 미주문 아이템들
     * - 변경 내용: ord_yn 플래그를 'N'에서 'Y'로 변경
     * - 효과: 장바구니에서 보이지 않게 되지만 데이터는 보존
     */
    await connection.query(query_3, [userid]);
    console.log('Carts 테이블 업데이트 완료');

    // 트랜잭션 커밋 (모든 작업 확정)
    await connection.commit();

    // 결제 처리 완료 로그
    console.log('결제 처리 완료 - 사용자:', username);

    // 결제 성공 응답 (사용자 친화적 메시지 포함)
    res.json({ 
      message: username + '님의 결제가 성공적으로 완료되었습니다!',
      success: true 
    });
  } catch (error) {
    // 오류 발생 시 롤백 (데이터 무결성 보장)
    if (connection) {
      await connection.rollback();
    }
    
    // 결제 처리 중 오류 발생 시 처리
    console.error('결제 처리 오류:', error);
    
    // HTTP 500 상태 코드와 함께 JSON 오류 응답
    res.status(500).json({ 
      error: '결제 처리 중 오류가 발생했습니다.',
      success: false 
    });
  } finally {
    // 연결 반환 (리소스 정리)
    if (connection) {
      connection.release();
    }
  }
});

/**
 * 라우터 모듈 내보내기
 * Express 애플리케이션에서 이 라우터를 사용할 수 있도록 내보냅니다.
 * 
 * 사용 방법:
 * const cartRouter = require('./routes/cartView');
 * app.use('/cart', cartRouter);
 * 
 * 결과적으로 다음 엔드포인트들이 생성됩니다:
 * - GET  /cart/          : 장바구니 페이지 (SSR)
 * - GET  /cart/api/items : 장바구니 데이터 조회 (JSON API)
 * - PUT  /cart/:id       : 장바구니 아이템 업데이트
 * - DELETE /cart/:id     : 장바구니 아이템 삭제
 * - POST /cart/pay       : 결제 처리
 */
module.exports = router;