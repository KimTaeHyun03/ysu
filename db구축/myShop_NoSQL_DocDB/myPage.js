/**
 * ========================================
 * myPage.js - 마이페이지 관리 모듈 (DocumentDB 호환 버전)
 * ========================================
 * 
 * 설명: 사용자의 개인정보, 주문내역, 상품평가 관리를 담당하는 Express 라우터 모듈
 * 주요 기능:
 * - 고객 정보 조회 및 표시
 * - 주문 내역 조회 (DocumentDB 호환 - 애플리케이션 레벨 조인)
 * - 상품 평가 등록/수정/삭제
 * - 서버 사이드 렌더링 및 API 제공
 * 
 * DocumentDB 호환 변경사항:
 * - 복잡한 $lookup 제거하고 단순 조인으로 변경
 * - 애플리케이션 레벨에서 데이터 조합 처리
 * - multiple join conditions 사용 금지
 */

// 필수 모듈 import
const express = require('express');           // Express 웹 프레임워크
const router = express.Router();              // Express 라우터 인스턴스 생성
const { ObjectId } = require('mongodb');      // MongoDB ObjectId 모듈
const db = require('./db.js');                // MongoDB 데이터베이스 연결 모듈
const cors = require('cors');                 // CORS 미들웨어
const authCheck = require('./authCheck.js');  // 사용자 인증 체크 모듈

// Express 애플리케이션 인스턴스 생성 및 CORS 설정
const app = express();
app.use(cors()); // 모든 Origin에서의 요청 허용 (개발 환경용)

/**
 * 공통 함수: 고객 정보 조회 (DocumentDB 호환)
 * @param {string} cust_id - 고객 ID (사용자 식별자)
 * @returns {Object|null} 고객 정보 객체 또는 null (고객이 없는 경우)
 * 
 * 설명: Customers 컬렉션에서 특정 고객의 기본 정보를 조회합니다.
 *       개인정보 보호를 위해 필요한 필드만 선택적으로 프로젝션합니다.
 */
async function getCustInfo(cust_id) {
  const custInfo = await db.collection('Customers').findOne(
    { _id: cust_id },
    { 
      projection: {
        _id: 1,
        cust_name: 1,
        m_phone: 1,
        // 임베드된 agreements 구조에서 약관 정보 조회
        'agreements.terms': 1,
        'agreements.privacy': 1,
        'agreements.marketing': 1
      }
    }
  );
  
  if (custInfo) {
    custInfo.cust_id = custInfo._id;
    // 임베드 구조를 기존 필드명으로 매핑 (호환성 유지)
    custInfo.a_term = custInfo.agreements?.terms;
    custInfo.a_privacy = custInfo.agreements?.privacy;
    custInfo.a_marketing = custInfo.agreements?.marketing;
  }

  console.log('고객 정보 조회 결과:', custInfo);
  return custInfo;
}

/**
 * 공통 함수: 주문 내역 조회 (DocumentDB 호환 버전)
 * @param {string} cust_id - 고객 ID
 * @returns {Array} 주문 내역 배열 (상품 정보와 평가 정보 포함)
 * 
 * 설명: DocumentDB 제한사항으로 인해 복잡한 $lookup을 피하고
 *      애플리케이션 레벨에서 조인을 처리합니다.
 * 
 * 처리 순서:
 * 1. Orders 컬렉션에서 사용자 주문 조회
 * 2. 각 주문의 상품들에 대해 Products 컬렉션 조회
 * 3. 각 주문 아이템에 대해 Reviews 컬렉션 조회
 * 4. 결과를 하나의 배열로 조합
 */
async function getPurchaseHistory(cust_id) {
  try {
    // 1단계: 사용자의 모든 주문 조회
    const orders = await db.collection('Orders').find({
      cust_id: cust_id
    }).sort({
      ord_date: -1,  // 최신 주문 우선
      ord_no: -1
    }).toArray();

    console.log(`주문 조회 완료: ${orders.length}개`);

    const allPurchases = [];

    // 2단계: 각 주문별로 상세 정보 조회 및 조합
    for (const order of orders) {
      // 각 주문의 아이템들 처리
      for (const item of order.items) {
        try {
          // 3단계: 상품 정보 조회
          const productInfo = await db.collection('Products').findOne(
            { _id: item.prod_cd },
            {
              projection: {
                _id: 1,
                prod_name: 1,
                price: 1,
                prod_img: 1,
                prod_type: 1,
                material: 1
              }
            }
          );

          // 4단계: 리뷰 정보 조회 (단순 조건만 사용)
          const reviewInfo = await db.collection('Reviews').findOne({
            cust_id: cust_id,
            ord_no: order.ord_no,
            ord_item_no: item.ord_item_no
          });

          // 5단계: 결과 조합
          const purchaseItem = {
            // 주문 정보
            ord_no: order.ord_no,
            ord_date: order.ord_date,
            ord_amount: order.ord_amount,
            
            // 상품 정보 (Products에서 조회)
            prod_cd: item.prod_cd,
            prod_name: productInfo?.prod_name || '상품명 없음',
            price: productInfo?.price || 0,
            prod_img: productInfo?.prod_img || 'no-image.jpg',
            prod_type: productInfo?.prod_type || '미분류',
            material: productInfo?.material || '재질 정보 없음',
            
            // 주문 상세 정보 (Orders의 items에서)
            ord_item_no: item.ord_item_no,
            prod_size: item.prod_size,
            ord_qty: item.ord_qty,
            unit_price: item.unit_price,
            review_written: item.review_written,
            
            // 리뷰 정보 (Reviews에서 조회)
            eval_seq_no: reviewInfo ? reviewInfo._id.toString() : null,
            eval_score: reviewInfo?.eval_score || null,
            eval_comment: reviewInfo?.eval_comment || null
          };

          allPurchases.push(purchaseItem);

        } catch (itemError) {
          console.error(`아이템 처리 오류 (주문: ${order.ord_no}, 아이템: ${item.ord_item_no}):`, itemError);
          
          // 오류가 발생해도 기본 정보는 포함
          const purchaseItem = {
            ord_no: order.ord_no,
            ord_date: order.ord_date,
            ord_amount: order.ord_amount,
            prod_cd: item.prod_cd,
            prod_name: '상품 정보 로드 오류',
            price: 0,
            prod_img: 'no-image.jpg',
            prod_type: '오류',
            material: '정보 없음',
            ord_item_no: item.ord_item_no,
            prod_size: item.prod_size,
            ord_qty: item.ord_qty,
            unit_price: item.unit_price,
            review_written: item.review_written,
            eval_seq_no: null,
            eval_score: null,
            eval_comment: null
          };
          
          allPurchases.push(purchaseItem);
        }
      }
    }

    console.log(`구매 내역 조합 완료: ${allPurchases.length}개 아이템`);
    return allPurchases;

  } catch (error) {
    console.error('구매 내역 조회 오류:', error);
    return [];
  }
}

/**
 * 공통 함수: 별점을 별 아이콘으로 변환
 * @param {number} score - 평점 (1-5 범위의 정수)
 * @returns {string} 별 아이콘 HTML 문자열
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
 * 공통 함수: 주문내역을 주문별로 그룹화
 * @param {Array} purchases - 주문 내역 배열
 * @returns {Array} 주문별로 그룹화된 배열
 */
function groupPurchasesByOrder(purchases) {
  const orderGroups = {}; // 주문번호를 키로 하는 객체
  
  // 각 주문 아이템을 순회하며 그룹화
  purchases.forEach(item => {
    // 해당 주문번호의 그룹이 없으면 새로 생성
    if (!orderGroups[item.ord_no]) {
      orderGroups[item.ord_no] = {
        ord_no: item.ord_no,           // 주문번호
        ord_date: item.ord_date,       // 주문일자
        ord_amount: item.ord_amount,   // 주문 총액
        items: []                      // 주문에 포함된 상품들의 배열
      };
    }
    
    // 현재 아이템을 해당 주문의 items 배열에 추가
    orderGroups[item.ord_no].items.push(item);
  });
  
  // 객체의 values만 추출하여 배열로 반환
  return Object.values(orderGroups);
}

/**
 * 보안 함수: HTML 특수문자 이스케이프 처리
 * @param {string} text - 이스케이프 처리할 텍스트
 * @returns {string} 이스케이프 처리된 안전한 텍스트
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
 */
router.get('/', async (req, res) => {
  try {
    // authCheck.statusUI()로 로그인된 사용자 정보 가져오기
    var usermenu = authCheck.statusUI(req, res);
    var userid = usermenu.split('/')[0];    // 사용자 ID 추출
    var username = usermenu.split('/')[1].split(' ')[0];  // 사용자 이름 추출
  
    // 마이페이지 접근 로그 (사용자 추적 및 디버깅 목적)
    console.log('마이페이지 로드 - 사용자 ID:', userid, '이름:', username);
    
    // 고객 정보 조회
    const custInfo = await getCustInfo(userid);
    if (!custInfo) {
      // 고객 정보가 없는 경우 404 오류 반환
      return res.status(404).send('고객 정보를 찾을 수 없습니다.');
    }
    
    // 주문 내역 조회 및 그룹화 (DocumentDB 호환 방식)
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
                                        
                                        console.log('[myPage] 상품 이미지 처리:', {
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
                                                <div class="item-price">₩${(item.unit_price * item.ord_qty).toLocaleString()}</div>
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
             */
            function hideAllRatingForms() {
                const forms = document.querySelectorAll('.rating-form');
                forms.forEach(form => form.classList.remove('active'));
            }
            
            /**
             * 별점 표시 업데이트 함수
             * @param {string} ordItemNo - 주문 아이템 번호
             * @param {number} score - 표시할 별점 (0-5)
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
                    console.error('prod-cd 요소를 찾을 수 없습니다:', 'prod-cd-' + ordItemNo);
                    alert('오류: 주문 정보를 찾을 수 없습니다.');
                    return;
                }
                
                const prodCd = prodCdElement.value.trim();
                
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
 * DocumentDB 호환 버전: 단순 조건만 사용
 */
router.post('/rating', async (req, res) => {
  try {
    // 사용자 인증 확인
    const authResult = authCheck.statusUI(req, res);
    if (!authResult || authResult === 'login') {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    
    const [userid] = authResult.split('/');
    const { prod_cd, ord_item_no, eval_score, eval_comment } = req.body;
    
    // 입력값 검증
    if (!prod_cd || !ord_item_no || !eval_score || eval_score < 1 || eval_score > 5) {
      return res.status(400).json({ error: '올바르지 않은 입력값입니다.' });
    }
    
    console.log('평가 등록/수정 요청:', { userid, prod_cd, ord_item_no, eval_score, eval_comment });
    
    // 주문번호 조회 (DocumentDB 호환: 단순 조건 사용)
    const orderInfo = await db.collection('Orders').findOne({
      cust_id: userid,
      'items.ord_item_no': parseInt(ord_item_no)
    });
    
    if (!orderInfo) {
      return res.status(404).json({ error: '해당 주문을 찾을 수 없습니다.' });
    }
    
    // Reviews 컬렉션에 upsert 수행
    const result = await db.collection('Reviews').updateOne(
      { 
        cust_id: userid,
        ord_item_no: parseInt(ord_item_no)
      },
      {
        $set: {
          ord_no: orderInfo.ord_no,
          prod_cd: prod_cd,
          cust_id: userid,
          ord_item_no: parseInt(ord_item_no),
          eval_score: parseInt(eval_score),
          eval_comment: eval_comment || null,
          eval_date: new Date()
        }
      },
      { upsert: true }
    );
    
    // Orders 컬렉션의 review_written 플래그 업데이트
    await db.collection('Orders').updateOne(
      { 
        cust_id: userid,
        'items.ord_item_no': parseInt(ord_item_no)
      },
      {
        $set: {
          'items.$.review_written': true
        }
      }
    );
    
    // 결과에 따른 응답 메시지 처리
    if (result.upsertedCount > 0) {
      console.log('평가 등록 완료:', { userid, ord_item_no, eval_score });
      res.json({ message: '상품 평가가 등록되었습니다.', success: true });
    } else if (result.modifiedCount > 0) {
      console.log('평가 수정 완료:', { userid, ord_item_no, eval_score });
      res.json({ message: '상품 평가가 수정되었습니다.', success: true });
    } else {
      console.log('평가 데이터 변경 없음:', { userid, ord_item_no, eval_score });
      res.json({ message: '평가가 처리되었습니다.', success: true });
    }
    
  } catch (error) {
    console.error('평가 등록/수정 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.', success: false });
  }
});

/**
 * API 엔드포인트: 평가 삭제 (DELETE /rating/:eval_seq_no)
 * DocumentDB 호환 버전
 */
router.delete('/rating/:eval_seq_no', async (req, res) => {
  try {
    const authResult = authCheck.statusUI(req, res);
    if (!authResult || authResult === 'login') {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    
    const [userid] = authResult.split('/');
    const { eval_seq_no } = req.params;
    
    console.log('평가 삭제 요청:', { userid, eval_seq_no });
    
    // 먼저 삭제할 리뷰 정보 조회 (ord_item_no 확인용)
    let reviewToDelete;
    if (ObjectId.isValid(eval_seq_no)) {
      reviewToDelete = await db.collection('Reviews').findOne({ 
        _id: new ObjectId(eval_seq_no),
        cust_id: userid
      });
    } else {
      reviewToDelete = await db.collection('Reviews').findOne({ 
        eval_seq_no: eval_seq_no,
        cust_id: userid
      });
    }
    
    if (!reviewToDelete) {
      return res.status(404).json({ error: '삭제할 평가를 찾을 수 없습니다.', success: false });
    }
    
    // 리뷰 삭제
    let deleteFilter;
    if (ObjectId.isValid(eval_seq_no)) {
      deleteFilter = { _id: new ObjectId(eval_seq_no) };
    } else {
      deleteFilter = { eval_seq_no: eval_seq_no };
    }
    
    const result = await db.collection('Reviews').deleteOne(deleteFilter);
    
    if (result.deletedCount > 0) {
      // Orders 컬렉션의 review_written 플래그 업데이트
      await db.collection('Orders').updateOne(
        { 
          cust_id: userid,
          'items.ord_item_no': reviewToDelete.ord_item_no
        },
        {
          $set: {
            'items.$.review_written': false
          }
        }
      );
      
      console.log('평가 삭제 완료:', { userid, eval_seq_no });
      res.json({ message: '상품 평가가 삭제되었습니다.', success: true });
    } else {
      console.log('삭제할 평가 없음:', { userid, eval_seq_no });
      res.status(404).json({ error: '삭제할 평가를 찾을 수 없습니다.', success: false });
    }
    
  } catch (error) {
    console.error('평가 삭제 오류:', error);
    
    if (error.name === 'BSONTypeError') {
      return res.status(400).json({ 
        error: '유효하지 않은 평가 ID 형식입니다.',
        success: false 
      });
    }
    
    res.status(500).json({ error: '서버 오류가 발생했습니다.', success: false });
  }
});

/**
 * API 엔드포인트: 주문내역 JSON 데이터 (GET /api/orders)
 * DocumentDB 호환 버전
 */
router.get('/api/orders', async (req, res) => {
  try {
    const authResult = authCheck.statusUI(req, res);
    if (!authResult || authResult === 'login') {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    
    const [userid] = authResult.split('/');
    
    // DocumentDB 호환 방식으로 주문내역 조회
    const purchases = await getPurchaseHistory(userid);
    const orderGroups = groupPurchasesByOrder(purchases);
    
    console.log(`[API] 주문내역 요청 - 사용자: ${userid}, 주문: ${orderGroups.length}개`);
    
    res.json({
      orders: orderGroups,
      totalOrders: orderGroups.length,
      totalItems: purchases.length,
      totalAmount: orderGroups.reduce((sum, order) => sum + order.ord_amount, 0)
    });
    
  } catch (error) {
    console.error('주문내역 API 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * API 엔드포인트: 고객정보 JSON 데이터 (GET /api/profile)
 * DocumentDB 호환 버전
 */
router.get('/api/profile', async (req, res) => {
  try {
    const authResult = authCheck.statusUI(req, res);
    if (!authResult || authResult === 'login') {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    
    const [userid] = authResult.split('/');
    
    const custInfo = await getCustInfo(userid);
    if (!custInfo) {
      return res.status(404).json({ error: '고객 정보를 찾을 수 없습니다.' });
    }
    
    console.log(`[API] 고객정보 요청 - 사용자: ${userid}`);
    
    res.json({
      cust: custInfo,
      success: true
    });
    
  } catch (error) {
    console.error('고객정보 API 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * 라우터 모듈 내보내기
 * DocumentDB 호환 버전의 마이페이지 라우터
 * 
 * 주요 변경사항:
 * - 복잡한 $lookup aggregation 제거
 * - 애플리케이션 레벨에서 조인 처리
 * - 단순한 find() 쿼리와 반복문 사용
 * - DocumentDB 제한사항 회피
 */
module.exports = router;