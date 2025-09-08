/**
 * ========================================================================
 * 마이페이지 관리 모듈 (myPage.js) - MySQL 버전
 * ========================================================================
 * 
 * 설명: 사용자의 개인정보, 주문내역, 상품평가 관리를 담당하는 Express 라우터 모듈
 * 주요 기능:
 * - 고객 정보 조회 및 표시
 * - 주문 내역 조회 및 그룹화
 * - 상품 평가 등록/수정/삭제
 * - 서버 사이드 렌더링 및 API 제공
 */

// 필수 모듈 import
const express = require('express');           // Express 웹 프레임워크
const router = express.Router();              // Express 라우터 인스턴스 생성
const db = require('./db.js');                // 데이터베이스 연결 모듈
const cors = require('cors');                 // CORS 미들웨어
const authCheck = require('./authCheck.js');  // 사용자 인증 체크 모듈

// Express 애플리케이션 인스턴스 생성 및 CORS 설정
const app = express();
app.use(cors()); // 모든 Origin에서의 요청 허용 (개발 환경용)

/**
 * 공통 함수: 고객 정보 조회
 * @param {string} cust_id - 고객 ID (사용자 식별자)
 * @returns {Object|null} 고객 정보 객체 또는 null (고객이 없는 경우)
 * 
 * 설명: Customers 테이블에서 특정 고객의 기본 정보를 조회합니다.
 *       개인정보 보호를 위해 필요한 필드만 선택적으로 조회합니다.
 * 
 * 조회 항목:
 * - cust_id: 고객 ID
 * - cust_name: 고객명
 * - m_phone: 휴대폰 번호
 * - a_term: 이용약관 동의 여부 ('Y'/'N')
 * - a_privacy: 개인정보 처리방침 동의 여부 ('Y'/'N')
 * - a_marketing: 마케팅 수신 동의 여부 ('Y'/'N')
 */
async function getCustInfo(cust_id) {
  // Prepared Statement 방식으로 SQL 인젝션 방지
  const [custInfo] = await db.query(
    `SELECT cust_id, cust_name, m_phone, a_term, a_privacy, a_marketing 
     FROM Customers 
     WHERE cust_id = ?`,  // 특정 고객의 정보만 조회
    [cust_id] // 파라미터 바인딩으로 보안 강화
  );
  
  // 조회 결과가 있으면 첫 번째 레코드 반환, 없으면 null 반환
  return custInfo[0] || null;
}

/**
 * 공통 함수: 주문 내역 조회 (상품 정보 포함)
 * @param {string} cust_id - 고객 ID
 * @returns {Array} 주문 내역 배열 (상품 정보와 평가 정보 포함)
 * 
 * 설명: 복잡한 JOIN 쿼리를 통해 주문, 주문상세, 상품, 평가 정보를 한 번에 조회합니다.
 *       LEFT JOIN을 사용하여 평가가 없는 상품도 포함시킵니다.
 * 
 * 테이블 관계:
 * - Orders (주문 마스터) 1:N Ord_items (주문 상세)
 * - Products (상품) 1:N Ord_items (주문 상세)
 * - Ord_items (주문 상세) 1:1 Prod_evals (상품 평가) - 선택적
 * 
 * 정렬 순서:
 * 1. 주문일 내림차순 (최신 주문 우선)
 * 2. 주문번호 내림차순 (같은 날짜 내에서 최신 주문 우선)
 * 3. 주문아이템번호 오름차순 (주문 내 아이템 정렬)
 */
async function getPurchaseHistory(cust_id) {
  const [purchases] = await db.query(
    `SELECT od.ord_no, od.ord_date, od.ord_amount,                    -- 주문 기본 정보
            pr.prod_cd, pr.prod_name, pr.price, pr.prod_img, pr.prod_type,  -- 상품 정보
            oi.ord_item_no, oi.prod_size, oi.ord_qty,                -- 주문 상세 정보
            pe.eval_seq_no, pe.eval_score, pe.eval_comment           -- 평가 정보 (선택적)
     FROM Orders od
        JOIN Ord_items oi ON od.ord_no = oi.ord_no                   -- 주문-주문상세 연결
        JOIN Products pr ON oi.prod_cd = pr.prod_cd                  -- 주문상세-상품 연결
        LEFT JOIN Prod_evals pe ON pe.ord_item_no = oi.ord_item_no   -- 주문상세-평가 연결 (선택적)
     WHERE od.cust_id = ?                                            -- 특정 고객의 주문만
     ORDER BY od.ord_date DESC, od.ord_no DESC, oi.ord_item_no       -- 최신순 정렬`,
    [cust_id]
  );
  return purchases;
}

/**
 * 공통 함수: 별점을 별 아이콘으로 변환
 * @param {number} score - 평점 (1-5 범위의 정수)
 * @returns {string} 별 아이콘 HTML 문자열
 * 
 * 설명: 숫자 평점을 시각적인 별 아이콘으로 변환하여 사용자 친화적인 UI를 제공합니다.
 *       평가가 없는 경우 "평가 안함" 메시지를 표시합니다.
 * 
 * 변환 규칙:
 * - score가 없거나 0인 경우: "평가 안함" 텍스트 표시
 * - 1-5점: 해당 점수만큼 채워진 별(★), 나머지는 빈 별(☆)
 * 
 * 생성되는 HTML:
 * - 채워진 별: <span class="star filled">★</span>
 * - 빈 별: <span class="star empty">☆</span>
 * - 평가 없음: <span class="no-rating">평가 안함</span>
 */
function generateStarsHTML(score) {
  // 평점이 없거나 0인 경우 처리
  if (!score) return '<span class="no-rating">평가 안함</span>';
  
  let starsHTML = '';
  
  // 1부터 5까지 반복하여 별 아이콘 생성
  for (let i = 1; i <= 5; i++) {
    if (i <= score) {
      // 현재 인덱스가 평점 이하이면 채워진 별
      starsHTML += '<span class="star filled">★</span>';
    } else {
      // 현재 인덱스가 평점 초과이면 빈 별
      starsHTML += '<span class="star empty">☆</span>';
    }
  }
  return starsHTML;
}


/**
 * 공통 함수: 주문내역을 주문별로 그룹화 (정렬 순서 유지)
 * @param {Array} purchases - 주문 내역 배열 (JOIN된 플랫 데이터)
 * @returns {Array} 주문별로 그룹화된 배열 (계층적 구조)
 * 
 * 설명: JOIN 쿼리로 인해 플랫하게 반환된 데이터를 주문별로 그룹화하여
 *       계층적 구조로 변환합니다. 이를 통해 UI에서 주문 단위로 표시할 수 있습니다.
 *       기존 버전과 달리 SQL의 원본 정렬 순서를 유지합니다.
 * 
 * 입력 데이터 구조: [주문1-상품1, 주문1-상품2, 주문2-상품1, ...]
 * 출력 데이터 구조: 
 * [
 *   { ord_no: 1, ord_date: '...', ord_amount: 1000, items: [상품1, 상품2] },
 *   { ord_no: 2, ord_date: '...', ord_amount: 2000, items: [상품1] }
 * ]
 * 
 * 처리 과정:
 * 1. 빈 객체(orderGroups)와 순서 기억용 배열(orderedKeys)로 시작
 * 2. 각 주문 아이템을 순회하며 주문번호별로 그룹 생성
 * 3. 주문 헤더 정보는 첫 번째 아이템에서 추출
 * 4. 각 아이템을 해당 주문의 items 배열에 추가
 * 5. orderedKeys.map()으로 원본 순서를 유지하며 배열로 변환하여 반환
 */
function groupPurchasesByOrder(purchases) {
  const orderGroups = {}; // 주문번호를 키로 하는 객체
  const orderedKeys = []; // 순서를 기억하기 위한 배열
  
  // 각 주문 아이템을 순회하며 그룹화
  purchases.forEach(item => {
    if (!orderGroups[item.ord_no]) {
      // 해당 주문번호의 그룹이 없으면 새로 생성
      orderGroups[item.ord_no] = {
        ord_no: item.ord_no,           // 주문번호
        ord_date: item.ord_date,       // 주문일자
        ord_amount: item.ord_amount,   // 주문 총액
        items: []                      // 주문에 포함된 상품들의 배열
      };
      // 순서 기록 (처음 등장하는 순서대로)
      orderedKeys.push(item.ord_no);
    }
    
    // 현재 아이템을 해당 주문의 items 배열에 추가
    orderGroups[item.ord_no].items.push(item);
  });
  
  // 원본 순서를 유지하면서 배열로 변환
  return orderedKeys.map(key => orderGroups[key]);
}

/**
 * 보안 함수: HTML 특수문자 이스케이프 처리
 * @param {string} text - 이스케이프 처리할 텍스트
 * @returns {string} 이스케이프 처리된 안전한 텍스트
 * 
 * 설명: 사용자 입력 데이터를 HTML에 출력할 때 XSS(Cross-Site Scripting) 공격을 
 *       방지하기 위해 특수문자를 HTML 엔티티로 변환합니다.
 * 
 * 변환 대상 특수문자:
 * - & → &amp;   (HTML 엔티티의 시작 문자)
 * - < → &lt;    (HTML 태그 시작)
 * - > → &gt;    (HTML 태그 끝)
 * - " → &quot;  (큰따옴표, 속성값 구분자)
 * - ' → &#39;   (작은따옴표, 속성값 구분자)
 * - ` → &#96;   (백틱, 템플릿 리터럴)
 * - $ → &#36;   (달러 기호, 템플릿 리터럴 변수)
 * 
 * 사용 시나리오:
 * - 사용자가 입력한 상품평 텍스트
 * - 동적으로 생성되는 HTML 컨텐츠
 * - 서버에서 클라이언트로 전송되는 데이터
 */
function escapeHtml(text) {
  // 빈 값이나 null/undefined 처리
  if (!text) return '';
  
  // 체이닝 방식으로 각 특수문자를 순차적으로 치환
  return text
    .replace(/&/g, '&amp;')    // &는 가장 먼저 처리 (다른 엔티티와 충돌 방지)
    .replace(/</g, '&lt;')     // < 태그 시작 문자
    .replace(/>/g, '&gt;')     // > 태그 끝 문자
    .replace(/"/g, '&quot;')   // 큰따옴표
    .replace(/'/g, '&#39;')    // 작은따옴표
    .replace(/`/g, '&#96;')    // 백틱 (템플릿 리터럴 방지)
    .replace(/\$/g, '&#36;');  // 달러 기호 (템플릿 리터럴 변수 방지)
}

/**
 * 메인 마이페이지 라우터 (GET /)
 * 고객정보와 주문내역을 보여주는 완전한 페이지 생성
 * 
 * 처리 과정:
 * 1. 사용자 인증 정보 확인 및 추출
 * 2. 고객 정보 조회
 * 3. 주문 내역 조회 및 그룹화
 * 4. 서버 사이드 렌더링으로 완전한 HTML 페이지 생성
 * 5. 클라이언트 사이드 JavaScript 포함 (평가 기능)
 */
router.get('/', async (req, res) => {
  try {
    // authCheck.statusUI()로 로그인된 사용자 정보 가져오기
    // 반환 형식: "userid/username 님 환영합니다 | <a href='/auth/logout'>로그아웃</a>"
    var usermenu = authCheck.statusUI(req, res);
    var userid = usermenu.split('/')[0];    // 사용자 ID 추출
    var username = usermenu.split('/')[1].split(' ')[0];  // 사용자 이름 추출
  
    // 마이페이지 접근 로그 (사용자 추적 및 디버깅 목적)
    console.log('👤 마이페이지 로드 - 사용자 ID:', userid, '이름:', username);
    
    // 고객 정보 조회
    const custInfo = await getCustInfo(userid);
    if (!custInfo) {
      // 고객 정보가 없는 경우 404 오류 반환
      return res.status(404).send('고객 정보를 찾을 수 없습니다.');
    }
    
    // 주문 내역 조회 및 그룹화
    const purchases = await getPurchaseHistory(userid);
    const orderGroups = groupPurchasesByOrder(purchases);
    
    // 마이페이지 데이터 로딩 상황 로그
    console.log(`[마이페이지] 사용자: ${username}, 총 주문: ${orderGroups.length}개`);
    
    // HTML 페이지 생성 (서버 사이드 렌더링)
    const html = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <!-- 기본 메타 정보 -->
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>마이페이지 - FASHION STORE</title>
        <!-- 외부 CSS 파일 링크 -->
        <link rel="stylesheet" href="/style.css">
    </head>
    <body>
        <!-- 헤더 영역: 네비게이션 포함 -->
        <div class="header">
            <div class="header-content">
                <h1>FASHION STORE</h1>
                <!-- 주요 네비게이션 링크 -->
                <div class="nav-links">
                    <a href="/main">홈</a>
                    <a href="/cart">장바구니</a>
                    <a href="/auth/logout">로그아웃</a>
                </div>
            </div>
        </div>
        
        <!-- 메인 컨테이너 -->
        <div class="container">
            <div class="main-content">
                <!-- 사이드바: 고객정보 표시 영역 -->
                <div class="sidebar">
                    <div class="profile-section">
                        <h2>고객정보</h2>
                        <!-- 기본 고객 정보 -->
                        <div class="profile-info">
                            <div class="info-item">
                                <span class="info-label">고객ID:</span>
                                <span class="info-value">${custInfo.cust_id}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">이름:</span>
                                <span class="info-value">${custInfo.cust_name}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">연락처:</span>
                                <!-- 연락처가 없는 경우 '미등록' 표시 -->
                                <span class="info-value">${custInfo.m_phone || '미등록'}</span>
                            </div>
                        </div>
                        
                        <!-- 약관 동의 현황 표시 -->
                        <div class="agreement-status">
                            <h3 style="margin-bottom: 15px; color: #4a5568; font-size: 1.1rem;">약관 동의 현황</h3>
                            <!-- 이용약관 동의 상태 -->
                            <div class="agreement-item">
                                <span>이용약관</span>
                                <!-- 동의 여부에 따라 CSS 클래스와 텍스트 조건부 설정 -->
                                <span class="status-badge ${custInfo.a_term === 'Y' ? 'status-yes' : 'status-no'}">
                                    ${custInfo.a_term === 'Y' ? '동의' : '미동의'}
                                </span>
                            </div>
                            <!-- 개인정보 처리방침 동의 상태 -->
                            <div class="agreement-item">
                                <span>개인정보 처리방침</span>
                                <span class="status-badge ${custInfo.a_privacy === 'Y' ? 'status-yes' : 'status-no'}">
                                    ${custInfo.a_privacy === 'Y' ? '동의' : '미동의'}
                                </span>
                            </div>
                            <!-- 마케팅 수신 동의 상태 -->
                            <div class="agreement-item">
                                <span>마케팅 수신</span>
                                <span class="status-badge ${custInfo.a_marketing === 'Y' ? 'status-yes' : 'status-no'}">
                                    ${custInfo.a_marketing === 'Y' ? '동의' : '미동의'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- 메인 영역: 주문내역 표시 -->
                <div class="content-area">
                    <h2>주문내역</h2>
                    
                    <!-- 주문 요약 통계 -->
                    <div class="purchase-summary">
                        <!-- 총 주문 수 -->
                        <div class="summary-item">
                            <span class="summary-number">${orderGroups.length}</span>
                            <span class="summary-label">총 주문 수</span>
                        </div>
                        <!-- 총 상품 수 (개별 아이템 기준) -->
                        <div class="summary-item">
                            <span class="summary-number">${purchases.length}</span>
                            <span class="summary-label">총 상품 수</span>
                        </div>
                        <!-- 총 주문 금액 (reduce로 합계 계산) -->
                        <div class="summary-item">
                            <span class="summary-number">₩${orderGroups.reduce((sum, order) => sum + order.ord_amount, 0).toLocaleString()}</span>
                            <span class="summary-label">총 주문 금액</span>
                        </div>
                    </div>
                    
                    <!-- 주문 목록 -->
                    <div class="order-list">
                        ${orderGroups.length > 0 ? orderGroups.map(order => `
                            <!-- 개별 주문 카드 -->
                            <div class="order-card">
                                <!-- 주문 헤더: 주문번호, 날짜, 총액 -->
                                <div class="order-header">
                                    <div class="order-info">
                                        <span class="order-number">주문번호: ${order.ord_no}</span>
                                        <!-- 날짜 포맷팅 (YYYY.MM.DD 형식) -->
                                        <span class="order-date">${new Date(order.ord_date).toLocaleDateString()}</span>
                                    </div>
                                    <!-- 주문 총액 (천 단위 구분 기호 포함) -->
                                    <div class="order-total">₩${order.ord_amount.toLocaleString()}</div>
                                </div>
                                <!-- 주문에 포함된 상품들 -->
                                <div class="order-items">
                                    ${order.items.map(item => {
                                        // 이미지 경로 처리 로직 추가
                                        const isUrl = item.prod_img && (item.prod_img.startsWith('http://') || item.prod_img.startsWith('https://'));
                                        const imageSrc = isUrl ? item.prod_img : '/img/' + item.prod_img;
                                        
                                        console.log('🖼️ [myPage] 상품 이미지 처리:', {
                                            prodName: item.prod_name,
                                            isUrl: isUrl,
                                            finalSrc: imageSrc
                                        });

                                        return `
                                        <!-- 개별 상품 행 -->
                                        <div class="item-row">
                                            <!-- hidden input: JavaScript에서 상품코드 참조용 -->
                                            <input type="hidden" id="prod-cd-${item.ord_item_no}" value="${item.prod_cd}">
                                            <!-- 상품 이미지 (오류 시 기본 이미지 표시) -->
                                            <img src="${imageSrc}" 
                                                alt="${item.prod_name}" 
                                                class="item-image"
                                                onerror="this.src='/img/no-image.jpg';">
                                            <!-- 상품 정보 영역 -->
                                            <div class="item-info">
                                                <div class="item-name">${item.prod_name}</div>
                                                <!-- 상품 세부 정보 (사이즈, 수량, 타입) -->
                                                <div class="item-details">
                                                    사이즈: ${item.prod_size} | 수량: ${item.ord_qty}개 | 
                                                    타입: ${item.prod_type}
                                                </div>
                                                <!-- 개별 상품 총 가격 (가격 × 수량) -->
                                                <div class="item-price">₩${(item.price * item.ord_qty).toLocaleString()}</div>
                                            </div>
                                            <!-- 평가 관련 영역 -->
                                            <div class="rating-section">
                                                <!-- 현재 평가 상태 표시 -->
                                                <div class="current-rating">
                                                    <!-- 별점을 시각적 아이콘으로 변환 -->
                                                    ${generateStarsHTML(item.eval_score)}
                                                    <!-- 평가 코멘트가 있는 경우 표시 -->
                                                    ${item.eval_comment ? `<div style="margin-top: 5px; font-size: 0.9rem; color: #4a5568; font-style: italic;">"${item.eval_comment}"</div>` : ''}
                                                </div>
                                                <!-- 평가 버튼들 (조건부 렌더링) -->
                                                ${item.eval_seq_no ? 
                                                    // 이미 평가가 있는 경우: 수정/삭제 버튼
                                                    `<div class="rating-buttons-group">
                                                        <button class="btn btn-edit" 
                                                            data-ord-item-no="${item.ord_item_no}" 
                                                            data-eval-score="${item.eval_score}"
                                                            data-eval-comment="${(item.eval_comment || '').replace(/[`$\\]/g, '\\$&').replace(/"/g, '&quot;')}"
                                                            onclick="editRating(this)">수정</button>
                                                        <button class="btn btn-delete"
                                                            data-eval-seq-no="${item.eval_seq_no}"
                                                            onclick="deleteRating(this)">삭제</button>
                                                    </div>` :
                                                    // 평가가 없는 경우: 평가하기 버튼
                                                    `<button class="btn btn-rate" onclick="showRatingForm('${item.ord_item_no}')">평가하기</button>`
                                                }
                                                
                                                <!-- 평가 입력 폼 (기본적으로 숨겨짐) -->
                                                <div class="rating-form" id="rating-form-${item.ord_item_no}">
                                                    <!-- 별점 입력 영역 (1-5점) -->
                                                    <div class="star-input" id="star-input-${item.ord_item_no}">
                                                        <span class="star" data-score="1">★</span>
                                                        <span class="star" data-score="2">★</span>
                                                        <span class="star" data-score="3">★</span>
                                                        <span class="star" data-score="4">★</span>
                                                        <span class="star" data-score="5">★</span>
                                                    </div>
                                                    <!-- 한줄평 입력 텍스트 영역 -->
                                                    <textarea class="comment-input" id="comment-${item.ord_item_no}" 
                                                              placeholder="상품에 대한 한줄평을 작성해주세요..."></textarea>
                                                    <!-- 평가 폼 버튼들 -->
                                                    <div class="rating-buttons">
                                                        <button class="btn btn-secondary" onclick="hideRatingForm('${item.ord_item_no}')">취소</button>
                                                        <button class="btn btn-primary" onclick="submitRating('${item.ord_item_no}')">등록</button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                  }).join('')}
                                </div>
                            </div>
                        `).join('') : `
                            <!-- 주문내역이 없는 경우 표시 -->
                            <div class="empty-state">
                                <h3>주문내역이 없습니다</h3>
                                <p>아직 주문하신 상품이 없습니다.</p>
                                <a href="/main">쇼핑하러 가기 →</a>
                            </div>
                        `}
                    </div>
                </div>
            </div>
        </div>
        
        <!-- 클라이언트 사이드 JavaScript -->
        <script>
            // 전역 변수: 현재 선택된 별점과 상품코드
            let currentScore = 0;
            let currentProdCd = '';
            
            /**
             * 평가 폼 표시 함수
             * @param {string} ordItemNo - 주문 아이템 번호
             * 
             * 설명: 사용자가 '평가하기' 버튼을 클릭했을 때 호출되며,
             *       평가 입력 폼을 표시하고 별점 클릭 이벤트를 등록합니다.
             */
            function showRatingForm(ordItemNo) {
                hideAllRatingForms();  // 다른 폼들은 모두 숨김
                currentOrdItemNo = ordItemNo;
                currentScore = 0;      // 별점 초기화
                
                // 해당 폼을 활성화 상태로 변경
                const form = document.getElementById('rating-form-' + ordItemNo);
                form.classList.add('active');
                
                // 별점 클릭 이벤트 등록
                const stars = document.querySelectorAll('#star-input-' + ordItemNo + ' .star');
                stars.forEach((star, index) => {
                    // 별점 클릭 시 점수 설정
                    star.addEventListener('click', function() {
                        currentScore = parseInt(this.dataset.score);
                        updateStarDisplay(ordItemNo, currentScore);
                    });
                    
                    // 마우스 호버 시 미리보기 효과
                    star.addEventListener('mouseover', function() {
                        const hoverScore = parseInt(this.dataset.score);
                        updateStarDisplay(ordItemNo, hoverScore);
                    });
                });
                
                // 마우스가 별점 영역을 벗어날 때 원래 점수로 복원
                document.getElementById('star-input-' + ordItemNo).addEventListener('mouseleave', function() {
                    updateStarDisplay(ordItemNo, currentScore);
                });
            }
            
            /**
             * 평가 수정 함수
             * @param {HTMLElement} button - 수정 버튼 요소
             * 
             * 설명: 기존 평가를 수정하기 위해 평가 폼에 기존 데이터를 미리 채웁니다.
             *       data 속성에서 기존 평가 정보를 추출하여 폼에 설정합니다.
             */
            function editRating(button) {
                console.log('수정 버튼 클릭됨');
                
                // 버튼의 data 속성에서 기존 평가 정보 추출
                const ordItemNo = button.dataset.ordItemNo;
                const evalScore = parseInt(button.dataset.evalScore);
                const evalComment = button.dataset.evalComment;
                
                console.log('수정 데이터:', {ordItemNo, evalScore, evalComment});
                
                // 평가 폼 표시
                showRatingForm(ordItemNo);
                currentScore = evalScore;  // 기존 별점 설정
                updateStarDisplay(ordItemNo, evalScore);  // 별점 표시 업데이트
                
                // 기존 코멘트를 텍스트 영역에 설정
                document.getElementById('comment-' + ordItemNo).value = evalComment;
            }
            
            /**
             * 평가 폼 숨기기 함수
             * @param {string} ordItemNo - 주문 아이템 번호
             * 
             * 설명: 사용자가 '취소' 버튼을 클릭했을 때 호출되며,
             *       평가 폼을 숨기고 입력 내용을 초기화합니다.
             */
            function hideRatingForm(ordItemNo) {
                const form = document.getElementById('rating-form-' + ordItemNo);
                form.classList.remove('active');  // 폼 숨김
                
                // 폼 내용 초기화
                currentScore = 0;
                updateStarDisplay(ordItemNo, 0);
                document.getElementById('comment-' + ordItemNo).value = '';
            }
            
            /**
             * 모든 평가 폼 숨기기 함수
             * 
             * 설명: 새로운 평가 폼을 열기 전에 기존에 열려있던 
             *       모든 평가 폼들을 닫습니다.
             */
            function hideAllRatingForms() {
                const forms = document.querySelectorAll('.rating-form');
                forms.forEach(form => form.classList.remove('active'));
            }
            
            /**
             * 별점 표시 업데이트 함수
             * @param {string} ordItemNo - 주문 아이템 번호
             * @param {number} score - 표시할 별점 (0-5)
             * 
             * 설명: 주어진 점수에 따라 별점의 시각적 표시를 업데이트합니다.
             *       선택된 점수까지는 금색, 나머지는 회색으로 표시합니다.
             */
            function updateStarDisplay(ordItemNo, score) {
                const stars = document.querySelectorAll('#star-input-' + ordItemNo + ' .star');
                stars.forEach((star, index) => {
                    if (index < score) {
                        // 선택된 별: 활성화 및 금색 표시
                        star.classList.add('active');
                        star.style.color = '#ffd700';
                    } else {
                        // 선택되지 않은 별: 비활성화 및 회색 표시
                        star.classList.remove('active');
                        star.style.color = '#e2e8f0';
                    }
                });
            }
            
            /**
             * 평가 제출 함수
             * @param {string} ordItemNo - 주문 아이템 번호
             * 
             * 설명: 사용자가 입력한 별점과 한줄평을 서버로 전송하여 평가를 등록/수정합니다.
             *       서버 API 호출 후 성공하면 페이지를 새로고침합니다.
             */
            async function submitRating(ordItemNo) {
                console.log('submitRating 호출됨, ordItemNo:', ordItemNo);
                
                // 별점 선택 여부 확인
                if (currentScore === 0) {
                    alert('별점을 선택해주세요.');
                    return;
                }
                
                // 입력된 한줄평 내용 가져오기 (공백 제거)
                const comment = document.getElementById('comment-' + ordItemNo).value.trim();
                
                // hidden input에서 상품코드 값 가져오기
                const prodCdElement = document.getElementById('prod-cd-' + ordItemNo);
                
                if (!prodCdElement) {
                    console.error('item-ordno 요소를 찾을 수 없습니다:', 'prod-cd-' + ordItemNo);
                    alert('오류: 주문 정보를 찾을 수 없습니다.');
                    return;
                }
                
                const prodCd = prodCdElement.value.trim(); // hidden input은 .value 사용 */
                
                console.log('평가 등록 데이터:', {prodCd, ordItemNo, currentScore, comment});
                
                try {
                    // 서버에 평가 데이터 전송 (POST 요청)
                    const response = await fetch('/mypage/rating', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',  // JSON 데이터 전송 명시
                        },
                        body: JSON.stringify({
                            prod_cd: prodCd,           // 상품 코드
                            ord_item_no: ordItemNo,    // 주문 아이템 번호
                            eval_score: currentScore,  // 선택된 별점
                            eval_comment: comment      // 입력된 한줄평
                        })
                    });
                    
                    // HTTP 응답 상태 확인
                    if (!response.ok) {
                        throw new Error('평가 등록에 실패했습니다.');
                    }
                    
                    // 서버 응답을 JSON으로 파싱
                    const result = await response.json();
                    alert(result.message);  // 성공 메시지 표시
                    
                    // 페이지 새로고침 (변경사항 반영)
                    window.location.reload();
                    
                } catch (error) {
                    // 오류 처리: 콘솔 로그 + 사용자 알림
                    console.error('평가 등록 오류:', error);
                    alert('평가 등록 중 오류가 발생했습니다.');
                }
            }
            
            /**
             * 평가 삭제 함수
             * @param {HTMLElement} button - 삭제 버튼 요소
             * 
             * 설명: 사용자가 등록한 평가를 삭제합니다.
             *       사용자 확인 후 서버에 DELETE 요청을 보내고 페이지를 새로고침합니다.
             */
            function deleteRating(button) {
              console.log('삭제 버튼 클릭됨');
              
              // 버튼의 data 속성에서 평가 번호 추출
              const evalSeqNo = button.dataset.evalSeqNo;
              
              // 사용자 확인 (취소 시 함수 종료)
              if (!confirm('이 상품의 평가를 삭제하시겠습니까?')) {
                  return;
              }
              
              console.log('삭제할 평가 번호:', evalSeqNo);
              
              // 서버에 DELETE 요청 전송
              fetch('/mypage/rating/' + evalSeqNo, {
                  method: 'DELETE',
                  headers: {
                      'Content-Type': 'application/json',
                  }
              })
              .then(response => response.json())  // JSON 응답 파싱
              .then(result => {
                  alert(result.message);          // 결과 메시지 표시
                  window.location.reload();       // 페이지 새로고침
              })
              .catch(error => {
                  // 오류 처리
                  console.error('삭제 오류:', error);
                  alert('삭제 중 오류가 발생했습니다.');
              });
          }

            // JavaScript 로드 완료 로그
            console.log('마이페이지 로드 완료');
        </script>
    </body>
    </html>
    `;
    
    // 생성된 HTML 페이지를 클라이언트에 전송
    res.send(html);
  } catch (error) {
    // 서버 사이드 렌더링 중 오류 발생 시 처리
    console.error('마이페이지 로드 오류:', error);
    
    // 사용자 친화적인 오류 페이지 반환
    res.status(500).send(`
      <html lang="ko">
      <head>
          <meta charset="UTF-8">
          <title>오류 발생</title>
          <!-- 인라인 CSS로 오류 페이지 스타일링 -->
          <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 100px; background: #f8f9fa; }
              .error-container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
              h1 { color: #dc3545; margin-bottom: 20px; }
              a { color: #007bff; text-decoration: none; }
          </style>
      </head>
      <body>
          <div class="error-container">
              <h1>페이지 로드 중 오류가 발생했습니다</h1>
              <p>잠시 후 다시 시도해주세요.</p>
              <a href="/main">← 메인으로 돌아가기</a>
          </div>
      </body>
      </html>
    `);
  }
});

/**
 * API 엔드포인트: 상품 평가 등록/수정 (POST /rating)
 * 사용자가 주문한 상품에 대한 평점과 한줄평을 등록하거나 수정합니다.
 * 
 * 비즈니스 로직:
 * - 기존 평가 존재 여부 확인 후 등록/수정 분기 처리
 * - 1-5점 범위의 별점과 선택적 텍스트 평가 지원
 * - 사용자 인증 및 입력값 검증 포함
 * 
 * 요청 형식:
 * {
 *   prod_cd: string,      // 상품 코드
 *   ord_item_no: string,  // 주문 아이템 번호
 *   eval_score: number,   // 평점 (1-5)
 *   eval_comment: string  // 한줄평 (선택사항)
 * }
 * 
 * 응답 형식:
 * {
 *   message: string,      // 성공/실패 메시지
 *   success: boolean      // 처리 결과
 * }
 */
router.post('/rating', async (req, res) => {
  try {
    // 사용자 인증 확인 (세션 기반 인증)
    const authResult = authCheck.statusUI(req, res);
    if (!authResult || authResult === 'login') {
      // 인증 실패 시 401 Unauthorized 반환
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    
    // 인증된 사용자 ID 추출
    const [userid] = authResult.split('/');
    
    // 요청 본문에서 평가 데이터 추출 (구조 분해 할당)
    const { prod_cd, ord_item_no, eval_score, eval_comment } = req.body;
    
    // 입력값 검증 (필수 필드 및 평점 범위 확인)
    if (!prod_cd || !ord_item_no || !eval_score || eval_score < 1 || eval_score > 5) {
      // 잘못된 입력값에 대해 400 Bad Request 반환
      return res.status(400).json({ error: '올바르지 않은 입력값입니다.' });
    }
    
    // 평가 등록/수정 요청 로그 (디버깅 및 감사 추적 목적)
    console.log('평가 등록/수정 요청:', { userid, prod_cd, ord_item_no, eval_score, eval_comment });
    
    // 기존 평가 존재 여부 확인
    const [existingEval] = await db.query(
      'SELECT eval_seq_no FROM Prod_evals WHERE ord_item_no = ?',  // 주문 아이템별로 평가는 1개만 존재
      [ord_item_no]
    );
    
    if (existingEval.length > 0) {
      // 기존 평가가 있는 경우: 수정 처리
      await db.query(
        'UPDATE Prod_evals SET eval_score = ?, eval_comment = ? WHERE ord_item_no = ?',
        [eval_score, eval_comment || null, ord_item_no]  // 빈 코멘트는 null로 저장
      );
      console.log('평가 수정 완료:', { userid, prod_cd, ord_item_no, eval_score, eval_comment });
      res.json({ message: '상품 평가가 수정되었습니다.', success: true });
    } else {
      // 기존 평가가 없는 경우: 새로운 평가 등록
      await db.query(
        'INSERT INTO Prod_evals (cust_id, prod_cd, ord_item_no, eval_score, eval_comment) VALUES (?, ?, ?, ?, ?)',
        [userid, prod_cd, ord_item_no, eval_score, eval_comment || null]  // 모든 필드 포함하여 삽입
      );
      console.log('평가 등록 완료:', { userid, prod_cd, ord_item_no, eval_score, eval_comment });
      res.json({ message: '상품 평가가 등록되었습니다.', success: true });
    }
    
  } catch (error) {
    // 데이터베이스 오류 또는 기타 서버 오류 처리
    console.error('평가 등록/수정 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.', success: false });
  }
});

/**
 * API 엔드포인트: 평가 삭제 (DELETE /rating/:eval_seq_no)
 * 사용자가 등록한 특정 상품의 평가를 삭제합니다.
 * 
 * REST API 설계 원칙:
 * - DELETE 메서드로 리소스 완전 삭제
 * - URL 파라미터로 삭제 대상 식별
 * - 멱등성 보장 (같은 요청 반복 시 결과 동일)
 * 
 * URL 형식: DELETE /mypage/rating/:eval_seq_no
 * 파라미터:
 * - eval_seq_no: 삭제할 평가의 고유 번호
 * 
 * 응답 형식:
 * {
 *   message: string,      // 성공/실패 메시지
 *   success: boolean      // 처리 결과
 * }
 * 
 * 주의사항:
 * - 물리적 삭제 (Hard Delete) 방식
 * - 복구 불가능한 작업
 * - 클라이언트에서 사용자 확인 필요
 */
router.delete('/rating/:eval_seq_no', async (req, res) => {
  try {
    // 사용자 인증 확인 (로그인 상태 검증)
    const authResult = authCheck.statusUI(req, res);
    if (!authResult || authResult === 'login') {
      // 인증되지 않은 사용자의 삭제 요청 차단
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    
    // 인증된 사용자 ID 추출
    const [userid] = authResult.split('/');
    
    // URL 파라미터에서 삭제할 평가 번호 추출
    const { eval_seq_no } = req.params;
    
    // 평가 삭제 요청 로그 (감사 추적 목적)
    console.log('평가 삭제 요청:', { userid, eval_seq_no });
    
    // 평가 삭제 실행 (물리적 삭제)
    const result = await db.query(
      'DELETE FROM Prod_evals WHERE eval_seq_no = ?',  // 평가 번호로 특정 평가만 삭제
      [eval_seq_no]
    );
    
    // 삭제 결과 확인 (영향받은 행 수로 성공 여부 판단)
    if (result[0].affectedRows > 0) {
      // 삭제 성공 (1개 이상의 행이 삭제됨)
      console.log('평가 삭제 완료:', { userid, eval_seq_no });
      res.json({ message: '상품 평가가 삭제되었습니다.', success: true });
    } else {
      // 삭제 실패 (해당 평가가 존재하지 않음)
      res.status(404).json({ error: '삭제할 평가를 찾을 수 없습니다.', success: false });
    }
    
  } catch (error) {
    // 데이터베이스 제약 조건 위반 또는 기타 서버 오류 처리
    console.error('평가 삭제 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.', success: false });
  }
});

/**
 * API 엔드포인트: 주문내역 JSON 데이터 (GET /api/orders)
 * AJAX 요청용 주문내역 데이터를 JSON 형태로 반환합니다.
 * 
 * 용도:
 * - 클라이언트 사이드 렌더링 (CSR) 지원
 * - 동적 데이터 업데이트 (실시간 주문 상태 확인)
 * - SPA(Single Page Application) 환경에서 활용
 * - 모바일 앱 또는 외부 시스템 연동
 * 
 * 응답 데이터 구조:
 * {
 *   orders: Array,        // 주문별로 그룹화된 주문내역
 *   totalOrders: number,  // 총 주문 수
 *   totalItems: number,   // 총 상품 수 (개별 아이템 기준)
 *   totalAmount: number   // 전체 주문 금액 합계
 * }
 * 
 * 데이터 처리 과정:
 * 1. 사용자 인증 확인
 * 2. 데이터베이스에서 주문내역 조회 (JOIN 쿼리)
 * 3. 주문별 그룹화 처리
 * 4. 통계 정보 계산
 * 5. JSON 응답 생성
 */
router.get('/api/orders', async (req, res) => {
  try {
    // 사용자 인증 확인 (API 접근 권한 검증)
    const authResult = authCheck.statusUI(req, res);
    if (!authResult || authResult === 'login') {
      // 인증되지 않은 API 요청 차단
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    
    // 인증된 사용자 ID 추출
    const [userid] = authResult.split('/');
    
    // 주문내역 조회 (기존 공통 함수 재사용)
    const purchases = await getPurchaseHistory(userid);
    const orderGroups = groupPurchasesByOrder(purchases);
    
    // API 요청 로그 (사용량 모니터링 목적)
    console.log(`[API] 주문내역 요청 - 사용자: ${userid}, 주문: ${orderGroups.length}개`);
    
    // 구조화된 JSON 응답 반환
    res.json({
      orders: orderGroups,                                                    // 주문별로 그룹화된 상세 데이터
      totalOrders: orderGroups.length,                                        // 총 주문 수 (주문 단위)
      totalItems: purchases.length,                                           // 총 상품 수 (아이템 단위)
      totalAmount: orderGroups.reduce((sum, order) => sum + order.ord_amount, 0)  // 전체 주문 금액 합계
    });
    
  } catch (error) {
    // API 오류 처리 (JSON 형태로 일관된 오류 응답)
    console.error('주문내역 API 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * API 엔드포인트: 고객정보 JSON 데이터 (GET /api/profile)
 * AJAX 요청용 고객정보 데이터를 JSON 형태로 반환합니다.
 * 
 * 용도:
 * - 프로필 관리 페이지에서 동적 데이터 로딩
 * - 사용자 정보 수정 폼의 초기값 설정
 * - 개인정보 동의 현황 실시간 확인
 * - 외부 시스템 연동 시 고객 정보 제공
 * 
 * 응답 데이터 구조:
 * {
 *   cust: {               // 고객 정보 객체
 *     cust_id: string,    // 고객 ID
 *     cust_name: string,  // 고객명
 *     m_phone: string,    // 휴대폰 번호
 *     a_term: string,     // 이용약관 동의 여부 ('Y'/'N')
 *     a_privacy: string,  // 개인정보 처리방침 동의 여부 ('Y'/'N')
 *     a_marketing: string // 마케팅 수신 동의 여부 ('Y'/'N')
 *   },
 *   success: boolean      // API 호출 성공 여부
 * }
 * 
 * 보안 고려사항:
 * - 민감한 개인정보는 제외 (비밀번호, 주민번호 등)
 * - 본인 정보만 조회 가능 (사용자 인증 기반)
 * - HTTPS 통신 권장
 */
router.get('/api/profile', async (req, res) => {
  try {
    // 사용자 인증 확인 (개인정보 접근 권한 검증)
    const authResult = authCheck.statusUI(req, res);
    if (!authResult || authResult === 'login') {
      // 인증되지 않은 개인정보 접근 시도 차단
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    
    // 인증된 사용자 ID 추출
    const [userid] = authResult.split('/');
    
    // 고객정보 조회 (기존 공통 함수 재사용)
    const custInfo = await getCustInfo(userid);
    if (!custInfo) {
      // 고객 정보가 없는 경우 404 Not Found 반환
      return res.status(404).json({ error: '고객 정보를 찾을 수 없습니다.' });
    }
    
    // API 요청 로그 (개인정보 접근 기록)
    console.log(`[API] 고객정보 요청 - 사용자: ${userid}`);
    
    // 고객정보 JSON 응답 반환
    res.json({
      cust: custInfo,      // 고객 정보 객체 (민감 정보 제외)
      success: true        // 성공 플래그
    });
    
  } catch (error) {
    // 개인정보 조회 오류 처리
    console.error('고객정보 API 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * 라우터 모듈 내보내기
 * Express 애플리케이션에서 이 라우터를 사용할 수 있도록 내보냅니다.
 * 
 * 사용법:
 * app.js에서 다음과 같이 등록:
 * const mypageRouter = require('./routes/mypage');
 * app.use('/mypage', mypageRouter);
 * 
 * 결과적으로 다음 엔드포인트들이 생성됩니다:
 * - GET  /mypage/              : 마이페이지 메인 (SSR)
 * - POST /mypage/rating        : 상품 평가 등록/수정
 * - DELETE /mypage/rating/:id  : 상품 평가 삭제
 * - GET  /mypage/api/orders    : 주문내역 JSON API
 * - GET  /mypage/api/profile   : 고객정보 JSON API
 * 
 * 라우터 특징:
 * - RESTful API 설계 원칙 준수
 * - 일관된 인증 체계 적용
 * - JSON 응답 형식 표준화
 * - 오류 처리 및 로깅 체계화
 * - 공통 함수 재사용으로 코드 중복 최소화
 */
module.exports = router;