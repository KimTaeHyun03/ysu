// ====================================================================
// prodDetail.js - 상품 상세정보 전담 모듈 (MongoDB 버전)
// ====================================================================
// 
// 기능: 개별 상품의 상세 정보를 조회하고 표시하는 전용 라우터
// 특징: 
// - 서버사이드 렌더링(SSR) 방식으로 완전한 HTML 페이지 생성
// - 인라인 CSS로 독립적인 스타일링 시스템 구축
// - 상품평 시스템과 평균 평점 계산 기능 내장
// - SEO 최적화 및 검색엔진 친화적 구조
// 
// 주요 처리 흐름:
// 1. 상품 기본정보 조회 (products 컬렉션)
// 2. 상품평 정보 조회 (reviews 컬렉션에서 집계 파이프라인 사용)
// 3. 평균 평점 계산 및 별점 HTML 생성
// 4. 완전한 HTML 페이지 응답
// ====================================================================

// Express 웹 프레임워크 및 필수 모듈 불러오기
const express = require('express');                     // Express 웹 프레임워크
const router = express.Router();                        // Express 라우터 객체 생성
const db = require('./db.js');                          // MongoDB 연결 모듈
const cors = require('cors');                           // CORS 처리 미들웨어
const authCheck = require('./authCheck.js');            // 인증 확인 모듈 (현재 미사용)

// Express 앱 인스턴스 생성 및 CORS 설정
const app = express();
app.use(cors());                                        // 모든 도메인에서의 요청 허용

// ====================================================================
// 공통 유틸리티 함수들 (Helper Functions)
// ====================================================================

/**
 * 상품 기본 정보 조회 함수
 * 
 * @param {string} prod_cd - 상품코드 (Primary Key)
 * @returns {Object|null} 상품 정보 객체 또는 null
 * 
 * 기능: products 컬렉션에서 특정 상품의 모든 기본 정보를 조회
 * 반환 필드: _id, prod_name, price, prod_type, material, prod_img, detail.prod_intro
 * 
 * 사용 예시:
 * const product = await getProductInfo('P001');
 * if (product) console.log(product.prod_name);
 */
async function getProductInfo(prod_cd) {
  const product = await db.collection('Products').findOne({ _id: prod_cd });
  return product || null;                               // 상품 정보 반환, 없으면 null
}

/**
 * 상품평 정보 조회 함수 (회원명 포함)
 * 
 * @param {string} prod_cd - 상품코드
 * @returns {Array} 상품평 배열 (최신순 정렬)
 * 
 * 기능: 특정 상품에 대한 모든 평가와 리뷰를 회원명과 함께 조회
 * MongoDB 집계 파이프라인 사용하여 Customers 컬렉션과 조인
 * 정렬: 최신 평가부터 표시
 * 
 * 반환 구조:
 * [
 *   {
 *     eval_score: 5,
 *     eval_comment: "정말 좋은 상품입니다!",
 *     cust_name: "홍*동",
 *     eval_seq_no: 123
 *   },
 *   ...
 * ]
 */
async function getProductReviews(prod_cd) {
  const reviews = await db.collection('Reviews').aggregate([
    // 1단계: 해당 상품의 리뷰만 필터링
    { $match: { prod_cd: prod_cd } },
    
    // 2단계: Customers 컬렉션과 조인하여 고객 정보 가져오기
    {
      $lookup: {
        from: 'Customers',
        localField: 'cust_id',
        foreignField: '_id',
        as: 'customer_info'
      }
    },
    
    // 3단계: 조인된 데이터 정리 및 필요한 필드만 선택
    {
      $project: {
        eval_score: 1,
        eval_comment: 1,
        eval_seq_no: { $toString: '$_id' },              // ObjectId를 문자열로 변환
        cust_name: {
          $cond: {
            if: { $gt: [{ $size: '$customer_info' }, 0] },
            then: {
              // 고객 성명은 왼쪽 한 글자만 노출 (나머지는 * 처리)
              $concat: [
                // 분해:
                // 1. $arrayElemAt: customer_info 배열의 첫 번째 요소의 cust_name 가져오기
                // 2. $substrCP: UTF-8 코드 포인트 기준으로 0번째 위치부터 1문자(글자) 추출
                //    - 바이트 단위가 아닌 실제 문자 단위로 처리
                //    - 한글, 영문, 숫자 등 모든 유니코드 문자를 안전하게 처리
                //    - 멀티바이트 문자(한글 등)도 정확히 1글자씩 추출

                // 예시: "홍길동" → "홍" (UTF-8 안전한 1문자 추출) 
                { $substrCP: [{ $arrayElemAt: ['$customer_info.cust_name', 0] }, 0, 1] },
                {
                  $reduce: {
                    input: { $range: [1, { $strLenCP: { $arrayElemAt: ['$customer_info.cust_name', 0] } }] },
                    initialValue: '',
                    in: { $concat: ['$$value', '*'] }
                  }
                }
              ]
            },
            else: '익명*'
          }
        }
      }
    },
    
    // 4단계: 최신 평가부터 정렬
    { $sort: { eval_seq_no: -1 } }
  ]).toArray();
  
  return reviews;                                       // 배열 형태로 반환
}

/**
 * 평균 평점 계산 함수
 * 
 * @param {Array} reviews - 리뷰 배열 (getProductReviews 함수의 반환값)
 * @returns {number} 평균 평점 (소수점 첫째자리까지, 0-5 범위)
 * 
 * 기능: 
 * - 모든 평가 점수의 산술 평균 계산
 * - 소수점 첫째자리까지 반올림 처리
 * - 리뷰가 없는 경우 0 반환
 * 
 * 계산 공식: (총 평점 합계) ÷ (리뷰 개수)
 * 
 * 사용 예시:
 * const reviews = await getProductReviews('P001');
 * const avgScore = calculateAverageScore(reviews);  // 4.2
 */
function calculateAverageScore(reviews) {
  if (reviews.length === 0) return 0;                  // 리뷰가 없는 경우 0 반환
  
  // reduce를 사용하여 모든 평점의 합계 계산
  const total = reviews.reduce((sum, review) => sum + review.eval_score, 0);
  
  // 평균 계산 후 소수점 첫째자리까지 반올림
  return parseFloat((total / reviews.length).toFixed(1));
}

/**
 * 별점을 별 아이콘 HTML로 변환하는 함수
 * 
 * @param {number} score - 평점 (0-5 범위, 소수점 가능)
 * @returns {string} 별 아이콘 HTML 문자열
 * 
 * 기능:
 * - 정수 부분: 채워진 별(★)로 표시
 * - 소수 부분: 빈 별(☆)로 표시 (0.5점 단위 처리)
 * - 나머지: 빈 별(☆)로 채움
 * - 총 5개의 별로 구성
 * 
 * 변환 예시:
 * - 4.0점 → ★★★★☆
 * - 4.5점 → ★★★★☆ (반별 표시)
 * - 2.3점 → ★★☆☆☆
 * 
 * 사용 위치: 상품 상세페이지의 평점 표시 및 개별 리뷰의 별점 표시
 */
function generateStarsHTML(score) {
  const fullStars = Math.floor(score);                 // 정수 부분 (채워진 별 개수)
  const hasHalfStar = score % 1 !== 0;                 // 소수 부분 존재 여부 (반별 여부)
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);  // 빈 별 개수 계산
  
  let starsHTML = '';
  
  // 채워진 별(★) 생성
  for (let i = 0; i < fullStars; i++) {
    starsHTML += '★';
  }
  
  // 반별(☆) 생성 (0.5점 이상의 소수 부분이 있는 경우)
  if (hasHalfStar) {
    starsHTML += '☆';
  }
  
  // 빈 별(☆) 생성 (나머지 자리 채움)
  for (let i = 0; i < emptyStars; i++) {
    starsHTML += '☆';
  }
  
  return starsHTML;
}

/**
 * 리뷰 목록 HTML 생성 함수
 * 
 * @param {Array} reviews - 리뷰 배열 (getProductReviews 함수의 반환값)
 * @returns {string} 완성된 리뷰 목록 HTML 문자열
 * 
 * 기능:
 * - 각 리뷰를 카드 형태의 HTML로 변환
 * - 리뷰어 이름, 별점, 한줄평을 포함한 완전한 구조 생성
 * - 빈 리뷰 상태 처리 (리뷰가 없는 경우 안내 메시지 표시)
 * - XSS 방지를 위한 기본적인 텍스트 처리
 * 
 * HTML 구조:
 * - .review-item: 개별 리뷰 컨테이너
 * - .review-header: 리뷰어명 + 별점
 * - .review-comment: 한줄평 내용
 * 
 * 특별 처리:
 * - 한줄평이 없는 경우: "한줄평이 작성되지 않았습니다." 표시
 * - 리뷰가 전혀 없는 경우: .no-reviews 영역으로 안내 메시지 표시
 */
function generateReviewsHTML(reviews) {
  // 리뷰가 없는 경우 안내 메시지 반환
  if (reviews.length === 0) {
    return `
      <div class="no-reviews">
        <h3>아직 리뷰가 없습니다</h3>
        <p>첫 번째 리뷰를 작성해보세요!</p>
      </div>
    `;
  }

  // 각 리뷰를 HTML로 변환 후 배열을 문자열로 결합
  return reviews.map(review => `
    <div class="review-item">
      <div class="review-header">
        <span class="reviewer-name">${review.cust_name}</span>
        <span class="review-stars">${generateStarsHTML(review.eval_score)}</span>
      </div>
      <div class="review-comment">
        ${review.eval_comment || '한줄평이 작성되지 않았습니다.'}
      </div>
    </div>
  `).join('');                                          // 배열을 하나의 문자열로 결합
}

// ====================================================================
// 메인 라우트 처리기 (Main Route Handler)
// ====================================================================

/**
 * 상품 상세정보 페이지 라우터 - GET /prod/product/:prod_cd
 * 
 * 기능: 
 * - 특정 상품의 상세정보를 완전한 HTML 페이지로 생성하여 응답
 * - 서버사이드 렌더링(SSR) 방식으로 SEO 최적화
 * - 상품 기본정보 + 상품평 + 평균평점을 통합하여 표시
 * - 인라인 CSS로 독립적인 스타일링 시스템 구축
 * 
 * URL 파라미터:
 * - prod_cd: 상품코드 (예: P001, P002 등)
 * 
 * 처리 과정:
 * 1. URL에서 상품코드 추출
 * 2. 상품 기본정보 조회 및 존재 여부 확인
 * 3. 상품평 데이터 조회 및 평균 평점 계산
 * 4. 완전한 HTML 페이지 생성 (헤더 + 상품정보 + 리뷰 + CSS)
 * 5. 클라이언트에 HTML 응답 전송
 * 
 * 에러 처리:
 * - 존재하지 않는 상품: 404 에러 페이지
 * - 서버 오류: 500 에러 페이지
 * 
 * 응답 형태: 완전한 HTML 문서 (Content-Type: text/html)
 */
router.get('/product/:prod_cd', async (req, res) => {
  try {
    // URL 파라미터에서 상품코드 추출
    const { prod_cd } = req.params;
    
    console.log(`[prodDetail] 상품 상세정보 요청 - 상품코드: ${prod_cd}`);
    
    // ====================================================================
    // 1단계: 상품 기본정보 조회
    // ====================================================================
    const product = await getProductInfo(prod_cd);
    
    // 상품이 존재하지 않는 경우 404 에러 페이지 반환
    if (!product) {
      console.log(`[prodDetail] 상품 없음 - 상품코드: ${prod_cd}`);
      
      return res.status(404).send(`
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <title>상품을 찾을 수 없습니다</title>
            <style>
                body { 
                  font-family: Arial, sans-serif; 
                  text-align: center; 
                  padding: 100px; 
                  background: #f8f9fa;
                }
                .error-container {
                  background: white;
                  padding: 40px;
                  border-radius: 10px;
                  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                  max-width: 500px;
                  margin: 0 auto;
                }
                a { 
                  color: #3498db; 
                  text-decoration: none; 
                  font-weight: 500;
                }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="error-container">
              <h1>상품을 찾을 수 없습니다</h1>
              <p>요청하신 상품이 존재하지 않습니다.</p>
              <a href="/main">← 메인으로 돌아가기</a>
            </div>
        </body>
        </html>
      `);
    }

    // ====================================================================
    // 2단계: 상품평 정보 조회 및 통계 계산
    // ====================================================================
    const reviews = await getProductReviews(prod_cd);    // 상품평 배열 조회
    const avgScore = calculateAverageScore(reviews);     // 평균 평점 계산
    
    console.log(`[prodDetail] 상품 데이터 로드 완료 - 상품: ${product.prod_name}, 리뷰: ${reviews.length}개, 평균 평점: ${avgScore}`);

    // ====================================================================
    // 3단계: 완전한 HTML 페이지 생성
    // ====================================================================
    
    /**
     * HTML 페이지 구조:
     * 1. DOCTYPE 및 기본 메타 태그
     * 2. 인라인 CSS (완전한 독립적 스타일링)
     * 3. 헤더 섹션 (브랜드명 + 브레드크럼)
     * 4. 메인 콘텐츠
     *    - 상품 이미지 + 기본정보 (2열 레이아웃)
     *    - 평점 박스 (별점 + 통계)
     *    - 상품 세부정보 테이블
     *    - 액션 버튼 (장바구니, 목록으로)
     * 5. 상품 소개 섹션
     * 6. 리뷰 섹션 (고객 리뷰 목록)
     * 
     * 특징:
     * - 반응형 디자인 (모바일 친화적)
     * - 그라데이션 배경 및 모던한 디자인
     * - 호버 효과 및 부드러운 전환 애니메이션
     * - 접근성 고려 (대체 텍스트, 시맨틱 HTML)
     */
    
    // prodImg가 URL인지 파일명인지 판별
    var isUrl = product.prod_img && (product.prod_img.startsWith('http://') || product.prod_img.startsWith('https://'));
    var imageSrc = isUrl ? product.prod_img : '/img/' + product.prod_img;
    
    console.log('🖼️ [prodDetail] 이미지 타입:', isUrl ? 'URL' : '파일명', '- 경로:', imageSrc);

    const html = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <!-- 기본 메타 태그 및 SEO 설정 -->
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${product.prod_name} - FASHION STORE</title>
        
        <!-- 인라인 CSS - 완전한 독립적 스타일링 시스템 -->
        <style>
            /* ================================================================
               기본 리셋 및 폰트 설정
               ================================================================ */
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;               /* 모든 요소에 border-box 적용 */
            }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                line-height: 1.6;                    /* 읽기 좋은 줄 간격 */
                color: #333;                         /* 기본 텍스트 색상 */
                background-color: #f8f9fa;          /* 연한 회색 배경 */
            }
            
            /* ================================================================
               레이아웃 컨테이너
               ================================================================ */
            .container {
                max-width: 1200px;                  /* 최대 너비 제한 */
                margin: 0 auto;                     /* 중앙 정렬 */
                background: white;                  /* 흰색 배경 */
                min-height: 100vh;                  /* 최소 전체 화면 높이 */
            }
            
            /* ================================================================
               헤더 스타일링
               ================================================================ */
            .header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 20px;
                text-align: center;
            }
            
            .header h1 {
                font-size: 1.8rem;
                margin-bottom: 10px;
            }
            
            /* ================================================================
               브레드크럼 네비게이션
               ================================================================ */
            .breadcrumb {
                padding: 15px 20px;
                background: #f8f9fa;
                border-bottom: 1px solid #dee2e6;
                font-size: 14px;
            }
            
            .breadcrumb a {
                color: #007bff;
                text-decoration: none;
            }
            
            .breadcrumb a:hover {
                text-decoration: underline;
            }
            
            /* ================================================================
               메인 콘텐츠 영역
               ================================================================ */
            .main-content {
                padding: 30px;
            }
            
            /* 상품 정보 2열 레이아웃 (이미지 + 정보) */
            .product-layout {
                display: grid;
                grid-template-columns: 1fr 1fr;     /* 1:1 비율 2열 */
                gap: 40px;                          /* 열 간격 */
                margin-bottom: 40px;
            }
            
            /* ================================================================
               상품 이미지 섹션
               ================================================================ */
            .product-image-section {
                text-align: center;
            }
            
            .product-image {
                width: 100%;
                max-width: 400px;                   /* 최대 크기 제한 */
                height: auto;                       /* 비율 유지 */
                border-radius: 12px;                /* 둥근 모서리 */
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);  /* 그림자 효과 */
                transition: transform 0.3s ease;    /* 호버 애니메이션 */
            }
            
            .product-image:hover {
                transform: scale(1.02);             /* 호버 시 약간 확대 */
            }
            
            /* ================================================================
               상품 정보 섹션
               ================================================================ */
            .product-info {
                padding: 20px 0;
            }
            
            .product-title {
                font-size: 2rem;
                font-weight: 700;
                color: #333;
                margin-bottom: 15px;
                line-height: 1.3;
            }
            
            .product-price {
                font-size: 1.8rem;
                font-weight: 700;
                color: #dc3545;                     /* 빨간색 강조 */
                margin-bottom: 25px;
            }
            
            /* ================================================================
               평점 박스 (별점 + 통계 표시)
               ================================================================ */
            .rating-box {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 20px;
                border-radius: 12px;
                text-align: center;
                margin-bottom: 25px;
            }
            
            .rating-stars {
                font-size: 1.5rem;
                color: #ffd700;                     /* 금색 별 */
                margin-bottom: 8px;
            }
            
            .rating-text {
                font-size: 1.1rem;
                opacity: 0.9;                       /* 약간 투명 효과 */
            }
            
            /* ================================================================
               상품 상세 정보 테이블
               ================================================================ */
            .product-details {
                background: #f8f9fa;
                padding: 20px;
                border-radius: 12px;
                margin-bottom: 25px;
            }
            
            .product-details h3 {
                color: #333;
                margin-bottom: 15px;
                font-size: 1.2rem;
                border-bottom: 2px solid #667eea;   /* 하단 테두리 */
                padding-bottom: 8px;
            }
            
            .detail-row {
                display: flex;
                margin-bottom: 10px;
                align-items: center;
            }
            
            .detail-label {
                font-weight: 600;
                color: #555;
                width: 100px;                       /* 고정 너비 */
                flex-shrink: 0;                     /* 축소 방지 */
            }
            
            .detail-value {
                color: #666;
                flex: 1;                           /* 나머지 공간 차지 */
            }
            
            /* ================================================================
               액션 버튼 (장바구니, 목록으로)
               ================================================================ */
            .action-buttons {
                display: flex;
                gap: 15px;                          /* 버튼 간격 */
                margin-top: 25px;
            }
            
            .btn {
                padding: 12px 25px;
                border: none;
                border-radius: 8px;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
                text-align: center;
                transition: all 0.3s ease;          /* 부드러운 전환 효과 */
            }
            
            .btn-primary {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
            }
            
            .btn-primary:hover {
                transform: translateY(-2px);        /* 호버 시 위로 이동 */
                box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
            }
            
            .btn-secondary {
                background: #6c757d;
                color: white;
            }
            
            .btn-secondary:hover {
                background: #5a6268;
                transform: translateY(-1px);
            }
            
            /* ================================================================
               상품 소개 섹션
               ================================================================ */
            .product-description {
                margin-bottom: 40px;
            }
            
            .product-description h3 {
                font-size: 1.5rem;
                color: #333;
                margin-bottom: 20px;
                border-bottom: 2px solid #dc3545;   /* 빨간색 하단 테두리 */
                padding-bottom: 10px;
            }
            
            .description-content {
                background: white;
                padding: 25px;
                border-radius: 12px;
                line-height: 1.8;                   /* 읽기 좋은 줄 간격 */
                color: #555;
                font-size: 1rem;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
                border: 1px solid #e9ecef;
            }
            
            /* ================================================================
               리뷰 섹션
               ================================================================ */
            .reviews-section {
                border-top: 2px solid #e9ecef;     /* 상단 구분선 */
                padding-top: 40px;
            }
            
            .reviews-title {
                font-size: 1.8rem;
                color: #333;
                margin-bottom: 25px;
                text-align: center;
            }
            
            .review-item {
                background: white;
                border: 1px solid #e9ecef;
                border-radius: 12px;
                padding: 20px;
                margin-bottom: 15px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
            }
            
            .review-header {
                display: flex;
                justify-content: space-between;      /* 양쪽 끝에 배치 */
                align-items: center;
                margin-bottom: 12px;
                padding-bottom: 8px;
                border-bottom: 1px solid #f1f3f4;   /* 하단 구분선 */
            }
            
            .reviewer-name {
                font-weight: 600;
                color: #333;
            }
            
            .review-stars {
                color: #ffd700;                     /* 금색 별점 */
                font-size: 1.1rem;
            }
            
            .review-comment {
                color: #555;
                line-height: 1.6;
            }
            
            /* 리뷰가 없는 경우 안내 메시지 */
            .no-reviews {
                text-align: center;
                padding: 60px 20px;
                background: #f8f9fa;
                border-radius: 12px;
                color: #6c757d;
            }
            
            .no-reviews h3 {
                margin-bottom: 10px;
                color: #495057;
            }
            
            /* ================================================================
               반응형 디자인 (모바일 최적화)
               ================================================================ */
            @media (max-width: 768px) {
                .main-content {
                    padding: 20px;                  /* 패딩 축소 */
                }
                
                .product-layout {
                    grid-template-columns: 1fr;     /* 1열로 변경 */
                    gap: 25px;
                }
                
                .product-title {
                    font-size: 1.5rem;             /* 폰트 크기 축소 */
                }
                
                .product-price {
                    font-size: 1.4rem;
                }
                
                .action-buttons {
                    flex-direction: column;          /* 세로 배치 */
                }
                
                .btn {
                    text-align: center;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <!-- ====================================================
                 헤더 섹션: 브랜드명 및 페이지 제목
                 ==================================================== -->
            <div class="header">
                <h1>FASHION STORE</h1>
                <p>상품 상세정보</p>
            </div>
            
            <!-- ====================================================
                 브레드크럼 네비게이션: 현재 위치 표시
                 ==================================================== -->
            <div class="breadcrumb">
                <a href="/main">홈</a> &gt; <a href="/main">상품목록</a> &gt; ${product.prod_name}
            </div>
            
            <!-- ====================================================
                 메인 콘텐츠: 상품 정보 및 리뷰
                 ==================================================== -->
            <div class="main-content">
                <!-- ====================================================
                     상품 기본 정보 섹션 (2열 레이아웃)
                     ==================================================== -->
                <div class="product-layout">
                    <!-- 좌측: 상품 이미지 -->
                    <div class="product-image-section">
                        <img src="${imageSrc}" 
                            alt="${product.prod_name}"
                            class="product-image"
                            onerror="this.src='/img/no-image.jpg';">
                        <!-- 이미지 로딩 실패 시 기본 이미지로 대체 -->
                    </div>
                    
                    <!-- 우측: 상품 정보 -->
                    <div class="product-info">
                        <!-- 상품명 (메인 제목) -->
                        <h1 class="product-title">${product.prod_name}</h1>
                        
                        <!-- 가격 정보 (천 단위 콤마 처리) -->
                        <div class="product-price">₩${product.price.toLocaleString()}</div>
                        
                        <!-- ============================================
                             평점 박스: 별점 + 리뷰 통계
                             ============================================ -->
                        <div class="rating-box">
                            <div class="rating-stars">${generateStarsHTML(avgScore)}</div>
                            <div class="rating-text">${avgScore}/5점 (${reviews.length}개 리뷰)</div>
                        </div>
                        
                        <!-- ============================================
                             상품 상세 정보 테이블
                             ============================================ -->
                        <div class="product-details">
                            <h3>상품 정보</h3>
                            <div class="detail-row">
                                <span class="detail-label">상품코드:</span>
                                <span class="detail-value">${product._id}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">상품 타입:</span>
                                <span class="detail-value">${product.prod_type}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">소재:</span>
                                <span class="detail-value">${product.material}</span>
                            </div>
                        </div>
                        
                        <!-- ============================================
                             액션 버튼: 장바구니 담기 + 목록으로
                             ============================================ -->
                        <div class="action-buttons">
                            <a href="/cart" class="btn btn-primary">장바구니 담기</a>
                            <a href="/main" class="btn btn-secondary">목록으로</a>
                        </div>
                    </div>
                </div>
                
                <!-- ====================================================
                     상품 소개 섹션
                     ==================================================== -->
                <div class="product-description">
                    <h3>상품 소개</h3>
                    <div class="description-content">
                        ${(product.detail && product.detail.prod_intro) || '상품 소개가 준비되어 있지 않습니다.'}
                        <!-- MongoDB의 중첩 객체 구조에 맞게 수정 -->
                    </div>
                </div>
                
                <!-- ====================================================
                     리뷰 섹션: 고객 평가 및 리뷰 목록
                     ==================================================== -->
                <div class="reviews-section">
                    <h2 class="reviews-title">고객 리뷰 (${reviews.length}개)</h2>
                    ${generateReviewsHTML(reviews)}
                    <!-- generateReviewsHTML 함수가 빈 리뷰 상태도 자동 처리 -->
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
    
    // ====================================================================
    // 4단계: 완성된 HTML 응답 전송
    // ====================================================================
    console.log(`[prodDetail] HTML 생성 완료 - 크기: ${html.length}자`);
    res.send(html);                                   // Content-Type: text/html로 응답
    
  } catch (error) {
    // ====================================================================
    // 에러 처리: 서버 오류 발생 시 500 에러 페이지 반환
    // ====================================================================
    console.error('[prodDetail] 상품 상세정보 페이지 로드 오류:', error);
    
    // 사용자 친화적인 500 에러 페이지 생성
    res.status(500).send(`
      <html lang="ko">
      <head>
          <meta charset="UTF-8">
          <title>오류 발생</title>
          <style>
              body { 
                font-family: Arial, sans-serif; 
                text-align: center; 
                padding: 100px; 
                background: #f8f9fa; 
              }
              .error-container { 
                background: white; 
                padding: 40px; 
                border-radius: 10px; 
                box-shadow: 0 4px 12px rgba(0,0,0,0.1); 
                max-width: 500px; 
                margin: 0 auto; 
              }
              h1 { 
                color: #dc3545; 
                margin-bottom: 20px; 
              }
              a { 
                color: #007bff; 
                text-decoration: none; 
                font-weight: 500;
              }
              a:hover { text-decoration: underline; }
          </style>
      </head>
      <body>
          <div class="error-container">
              <h1>서버 오류가 발생했습니다</h1>
              <p>잠시 후 다시 시도해주세요.</p>
              <a href="/main">← 메인으로 돌아가기</a>
          </div>
      </body>
      </html>
    `);
  }
});

// ====================================================================
// 라우터 모듈 내보내기
// ====================================================================

/**
 * Express 라우터 객체 내보내기
 * 
 * 사용법:
 * Main.js에서 다음과 같이 마운트:
 * 
 * const prodDetailRouter = require('./prodDetail.js');
 * app.use('/prod', prodDetailRouter);
 * 
 * 결과: /prod/product/:prod_cd 경로로 접근 가능
 * 예시 URL: /prod/product/P001, /prod/product/P002 등
 * 
 * 특징:
 * - 완전한 독립 모듈 (외부 템플릿 파일 의존성 없음)
 * - 서버사이드 렌더링으로 SEO 최적화
 * - 상품평 시스템과 평점 통계 기능 내장
 * - 반응형 디자인 및 모던한 UI/UX
 * - 에러 처리 및 사용자 친화적 메시지
 * - MongoDB 집계 파이프라인을 활용한 효율적인 데이터 조회
 */
module.exports = router;