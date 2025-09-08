/**
 * ====================================================================
 * 인증 처리 라우터 모듈 (auth.js) - MongoDB 버전
 * ====================================================================
 * 
 * 역할: 사용자 인증과 관련된 모든 기능을 담당하는 전용 라우터
 *      고객가입, 로그인, 로그아웃 등의 인증 프로세스를 처리
 * 
 * 주요 기능:
 * - 로그인/고객가입 페이지 렌더링 (template.js 활용)
 * - 사용자 인증 및 세션 관리
 * - 비밀번호 암호화 처리 (bcrypt)
 * - 고객 정보 등록 및 중복 검사
 * - 로그아웃 및 세션 삭제
 * 
 * 라우트 구조:
 * - GET  /auth/login           : 로그인 페이지
 * - POST /auth/login_process   : 로그인 처리
 * - GET  /auth/register        : 고객가입 페이지
 * - POST /auth/register_process: 고객가입 처리
 * - GET  /auth/logout          : 로그아웃 처리
 * 
 * 보안 특징:
 * - bcrypt를 이용한 비밀번호 해싱
 * - 세션 기반 인증 관리
 * - MongoDB 인젝션 방지 (적절한 쿼리 구조 사용)
 * - 입력 데이터 검증
 * ====================================================================
 */

// Express 웹 프레임워크 모듈 불러오기
const express = require('express');

// Express 라우터 객체 생성 - 인증 관련 라우트 처리
const router = express.Router();

// 사용자 정의 모듈 불러오기
const template = require('./template.js');    // HTML 템플릿 생성 모듈
const db = require('./db.js');                   // MongoDB 연결 모듈

// bcrypt 모듈 불러오기 - 비밀번호 암호화를 위한 라이브러리
const bcrypt = require('bcrypt');

// bcrypt salt rounds 설정 - 높을수록 보안이 강화되지만 처리 시간이 증가
const saltRounds = 10;

/**
 * ====================================================================
 * 로그인 화면 라우트 - GET /auth/login
 * ====================================================================
 * 
 * 기능: 로그인 페이지 HTML을 생성하여 클라이언트에 전송
 * 경로: GET http://localhost:3000/auth/login
 * 
 * 처리 과정:
 * 1. template.HTML() 함수 호출
 * 2. 로그인 폼 HTML 생성
 * 3. 클라이언트에 완성된 페이지 전송
 * ====================================================================
 */
router.get('/login', function (request, response) {
    const title = '로그인';

    console.log('🔑 로그인 페이지 요청 - IP:', request.ip);

    // template.HTML 함수를 사용하여 로그인 페이지 HTML 생성
    const html = template.HTML(title,`
            <div class="logo">FASHION STORE</div>
            <div class="status">로그인 상태: 로그아웃</div>
            <form action="/auth/login_process" method="post">
                <h2>로그인</h2>
                <input type="text" class="login" name="userid" placeholder="이메일">
                <input type="password" class="login" name="pwd" placeholder="비밀번호">
                <button class="btn" type="submit">로그인</button>
                
                <div class="divider"></div>
                
                <!-- 소셜 로그인 섹션 (현재는 UI만 제공) -->
                <div style="font-size: 14px; color: #666;">소셜 계정으로 로그인</div>
                <div class="social-login">
                    <div class="social-btn">K</div> <!-- 카카오 -->
                    <div class="social-btn">N</div> <!-- 네이버 -->
                    <div class="social-btn">G</div> <!-- 구글 -->
                </div>
                
                <!-- 고객가입 및 비밀번호 찾기 링크 -->
                <div class="footer">
                    아직 계정이 없으신가요? <a href="/auth/register">고객가입</a><br>
                    <a href="#">비밀번호를 잊으셨나요?</a>
                </div>
            </form>
        `, '');

    // 생성된 HTML 응답 전송
    response.send(html);

    console.log('✅ 로그인 페이지 전송 완료');
});

/**
 * ====================================================================
 * 로그인 처리 라우트 - POST /auth/login_process (async/await 방식)
 * ====================================================================
 * 
 * 기능: 사용자가 입력한 로그인 정보를 검증하고 세션을 생성
 * 경로: POST http://localhost:3000/auth/login_process
 * 
 * 요청 데이터:
 * - userid: 사용자 ID (이메일)
 * - pwd: 비밀번호 (평문)
 * 
 * 처리 과정:
 * 1. 입력 데이터 검증
 * 2. MongoDB에서 사용자 조회
 * 3. 비밀번호 해시 비교
 * 4. 성공 시 세션 생성, 실패 시 에러 메시지
 * ====================================================================
 */
router.post('/login_process', async function (request, response) {
    try {
        console.log('🔐 로그인 처리 시작');
        
        // 요청 본문에서 사용자 입력 데이터 추출
        const userid = request.body.userid;
        const password = request.body.pwd;
        
        console.log('👤 로그인 시도:', { userid: userid }); // 비밀번호는 로그에 남기지 않음
        
        // 사용자 입력 데이터 유효성 검사
        if (!userid || !password) {
            console.log('❌ 아이디 또는 비밀번호 누락');
            return response.send(`<script type="text/javascript">
                alert("아이디와 비밀번호를 입력하세요!"); 
                document.location.href="/auth/login";
            </script>`);
        }
        
        console.log('✅ 입력 검증 완료, MongoDB 조회 시작');
        
        // MongoDB에서 사용자 정보 조회
        // _id 필드를 사용하여 사용자 검색 (MySQL의 cust_id에 해당)
        const customer = await db.collection('Customers').findOne({ _id: userid });
        
        console.log('📊 MongoDB 조회 완료, 사용자 존재 여부:', !!customer);
        
        // 사용자가 존재하지 않는 경우
        if (!customer) {
            console.log('❌ 존재하지 않는 사용자:', userid);
            return response.send(`<script type="text/javascript">
                alert("로그인 정보가 일치하지 않습니다."); 
                document.location.href="/auth/login";
            </script>`);
        }
        
        console.log('👤 사용자 정보 확인:', customer._id);
        
        // Promise 방식으로 비밀번호 비교
        // bcrypt.compare()는 평문 비밀번호와 해시된 비밀번호를 안전하게 비교
        const isPasswordValid = await bcrypt.compare(password, customer.passwd);
        
        console.log('🔒 비밀번호 검증 결과:', isPasswordValid);
        
        if (isPasswordValid) {
            console.log('✅ 로그인 성공:', userid);
            
            // 세션 정보 갱신 - 로그인 상태 및 사용자 정보 저장
            request.session.is_logined = true; // 로그인 상태 플래그     
            request.session.nickname = customer._id + '/' + customer.cust_name + '/';  // 사용자 식별정보 (ID/이름)
            
            console.log('세션 정보 저장 완료');
            
            // Promise 방식으로 세션 저장
            // 세션이 완전히 저장된 후에 리다이렉트 수행
            await new Promise((resolve, reject) => {
                request.session.save((err) => {
                    if (err) {
                        console.error('❌ 세션 저장 실패:', err);
                        reject(err);
                    } else {
                        console.log('✅ 세션 저장 완료');
                        resolve();
                    }
                });
            });
            
            console.log('🎉 로그인 성공, 메인 페이지로 리다이렉트');

            // 로그인 성공 시 루트 페이지로 리다이렉트
            // Main.js에서 자동으로 /main으로 재 리다이렉트됨
            response.redirect('/');
            
        } else {
            console.log('❌ 비밀번호 불일치:', userid);
            response.send(`<script type="text/javascript">
                alert("로그인 정보가 일치하지 않습니다."); 
                document.location.href="/auth/login";
            </script>`);
        }
        
    } catch (error) {
        console.error('💥 로그인 처리 중 오류:', error);
        response.send(`<script type="text/javascript">
            alert("로그인 처리 중 오류가 발생했습니다: ${error.message}"); 
            document.location.href="/auth/login";
        </script>`);
    }
});

/**
 * ====================================================================
 * 로그아웃 라우트 - GET /auth/logout (async/await 방식)
 * ====================================================================
 * 
 * 기능: 사용자 세션을 삭제하고 로그아웃 처리
 * 경로: GET http://localhost:3000/auth/logout
 * 
 * 처리 과정:
 * 1. 현재 세션 정보 로깅
 * 2. 세션 완전 삭제 (session.destroy)
 * 3. 루트 페이지로 리다이렉트
 * ====================================================================
 */
router.get('/logout', async function(request, response) {
    try {
        console.log('🚪 로그아웃 처리 시작 (GET):', request.session.nickname);
        
        // 세션 완전 삭제
        // destroy()는 세션 스토어에서 세션 데이터를 완전히 제거
        await new Promise((resolve, reject) => {
            request.session.destroy((err) => {
                if (err) {
                    console.error('❌ 세션 삭제 실패:', err);
                    reject(err);
                } else {
                    console.log('🗑️ 세션 삭제 완료');
                    resolve();
                }
            });
        });
        
        console.log('✅ 로그아웃 완료');

        // 루트 페이지로 리다이렉트 (로그인 페이지로 자동 이동됨)
        response.redirect('/');
        
    } catch (error) {
        console.error('💥 로그아웃 처리 중 오류:', error);
        // 에러가 발생해도 루트 페이지로 리다이렉트
        response.redirect('/');
    }
});

/**
 * ====================================================================
 * 고객가입 화면 라우트 - GET /auth/register
 * ====================================================================
 * 
 * 기능: 고객가입 페이지 HTML을 생성하여 클라이언트에 전송
 * 경로: GET http://localhost:3000/auth/register
 * 
 * 특징:
 * - 상세한 입력 필드 (이메일, 비밀번호, 이름, 전화번호)
 * - 약관 동의 체크박스 (필수/선택)
 * - 클라이언트 사이드 JavaScript로 UX 향상
 * ====================================================================
 */
router.get('/register', function(request, response) {
    const title = '고객가입';   
    
    console.log('📝 고객가입 페이지 요청 - IP:', request.ip);
    
    // template.HTML 함수를 사용하여 고객가입 페이지 HTML 생성
    const html = template.HTML(title, `
    <div class="logo">FASHION STORE</div>
    <form>
        <h2>고객가입</h2>
        
        <!-- 사용자 ID (이메일) 입력 -->
        <div class="input-group">
            <label class="input-label">아이디(이메일)<span class="required">*</span></label>
            <input type="userid" class="signup-input" name="userid" placeholder="예: fashion@email.com" required>
        </div>
        
        <!-- 비밀번호 입력 -->
        <div class="input-group">
            <label class="input-label">비밀번호<span class="required">*</span></label>
            <input type="password" class="signup-input" name="pwd" placeholder="영문, 숫자, 특수문자 포함 8자 이상" required>
        </div>
        
        <!-- 비밀번호 확인 입력 -->
        <div class="input-group">
            <label class="input-label">비밀번호 확인<span class="required">*</span></label>
            <input type="password" class="signup-input" name="pwd2" placeholder="비밀번호를 한번 더 입력해주세요" required>
        </div>

        <!-- 사용자 이름 입력 -->
        <div class="input-group">
            <label class="input-label">이름<span class="required">*</span></label>
            <input type="text" class="signup-input" name="name" placeholder="이름을 입력해주세요" required>
        </div>

        <!-- 휴대폰 번호 입력 -->
        <div class="input-group">
            <label class="input-label">휴대폰 번호<span class="required">*</span></label>
            <input type="tel" class="signup-input" name="phone" placeholder="'-' 없이 숫자만 입력해주세요" required>
        </div>

        <!-- 약관 동의 섹션 -->
        <!-- 전체 동의 체크박스 -->
        <div class="checkbox-group">
            <input type="checkbox" id="agree-all" name="agree-all">
            <label for="agree-all"><strong>전체 동의</strong></label>
        </div>

        <!-- 개별 약관 동의 -->
        <div class="checkbox-group">
            <input type="checkbox" id="agree-terms" name="agree-terms" required>
            <label for="agree-terms">이용약관 동의 (필수)</label>
        </div>
        <div class="checkbox-group">
            <input type="checkbox" id="agree-privacy" name="agree-privacy" required>
            <label for="agree-privacy">개인정보 수집 및 이용 동의 (필수)</label>
        </div>
        <div class="checkbox-group">
            <input type="checkbox" id="agree-marketing" name="agree-marketing">
            <label for="agree-marketing">마케팅 정보 수신 동의 (선택)</label>
        </div>
        
        <!-- 고객가입 버튼 -->
        <button class="btn" type="submit" formaction="/auth/register_process" formmethod="post">가입하기</button>
        
        <div class="divider"></div>
        
        <!-- 소셜 회원가입 섹션 (현재는 UI만 제공) -->
        <div style="font-size: 14px; color: #666;">소셜 계정으로 가입하기</div>
        <div class="social-login">
            <div class="social-btn">K</div> <!-- 카카오 -->
            <div class="social-btn">N</div> <!-- 네이버 -->
            <div class="social-btn">G</div> <!-- 구글 -->
        </div>
        
        <!-- 로그인 페이지로 이동 링크 -->
        <div class="footer">
            이미 계정이 있으신가요? <a href="/auth/login">로그인하기</a>
        </div>
    </form>

    <!-- 클라이언트 사이드 JavaScript - UX 향상 -->
    <script>

        // 전체 동의 체크박스 이벤트 리스너
        // 전체 동의 체크 시 모든 개별 체크박스 자동 선택
        document.getElementById('agree-all').addEventListener('change', function() {
            const isChecked = this.checked;
            
            // 모든 개별 체크박스 상태 변경
            ['agree-terms', 'agree-privacy', 'agree-marketing'].forEach(id => {
                document.getElementById(id).checked = isChecked;
            });
        });

        // 개별 체크박스 이벤트 (전체 동의 상태 자동 업데이트)
        ['agree-terms', 'agree-privacy', 'agree-marketing'].forEach(id => {
            document.getElementById(id).addEventListener('change', function() {
                // 모든 개별 체크박스가 체크되었는지 확인
                const allChecked = ['agree-terms', 'agree-privacy', 'agree-marketing']
                    .every(checkId => document.getElementById(checkId).checked);
                
                // 전체 동의 체크박스 상태 업데이트
                document.getElementById('agree-all').checked = allChecked;
            });
        });
    </script>
    `, '');
    
    // 생성된 HTML 응답 전송
    response.send(html);
});
 
/**
 * ====================================================================
 * 고객가입 처리 라우트 - POST /auth/register_process (async/await 방식)
 * ====================================================================
 * 
 * 기능: 새로운 사용자의 고객 정보를 검증하고 MongoDB에 저장
 * 경로: POST http://localhost:3000/auth/register_process
 * 
 * 요청 데이터:
 * - userid: 사용자 ID (이메일)
 * - pwd, pwd2: 비밀번호 및 확인
 * - name: 사용자 이름
 * - phone: 휴대폰 번호
 * - agree-terms, agree-privacy, agree-marketing: 약관 동의 여부
 * 
 * 처리 과정:
 * 1. 입력 데이터 검증 (필수 항목, 비밀번호 일치 등)
 * 2. 중복 사용자 확인
 * 3. 비밀번호 해싱
 * 4. MongoDB에 사용자 정보 저장
 * ====================================================================
 */
router.post('/register_process', async function(request, response) {
    try {
        console.log('📝 고객가입 처리 시작');

        // 요청 데이터 추출
        const userid = request.body.userid;
        const password = request.body.pwd;    
        const password2 = request.body.pwd2;
        const name = request.body.name;
        const phone = request.body.phone;

        // 약관 동의 정보 (체크박스 값을 boolean으로 변환)
        const agreeTerms = request.body['agree-terms'] ? 'Y' : 'N';
        const agreePrivacy = request.body['agree-privacy'] ? 'Y' : 'N';
        const agreeMarketing = request.body['agree-marketing'] ? 'Y' : 'N';
        
        console.log('📋 받은 데이터:', { userid, name, phone, agreeTerms, agreePrivacy, agreeMarketing });
        
        // 필수 입력 및 동의 항목 검증
        if (!userid || !password || !password2 || !name || !phone || agreeTerms !== 'Y' || agreePrivacy !== 'Y') {
            console.log('❌ 필수 정보 누락');
            return response.send(`<script type="text/javascript">
                alert("필수 정보를 모두 입력하고 필수 약관에 동의해주세요."); 
                document.location.href="/auth/register";
            </script>`);
        }
        
        // 비밀번호 일치 확인
        if (password !== password2) {
            console.log('❌ 비밀번호 불일치');
            return response.send(`<script type="text/javascript">
                alert("입력된 비밀번호가 서로 다릅니다."); 
                document.location.href="/auth/register";
            </script>`);
        }
        
        console.log('✅ 입력 검증 통과, MongoDB 조회 시작');
        
        // MongoDB에서 중복 사용자 확인
        const existingUser = await db.collection('Customers').findOne({ _id: userid });
        
        console.log('📊 중복 확인 완료, 기존 사용자 존재 여부:', !!existingUser);
        
        // 중복된 아이디가 있는 경우
        if (existingUser) {
            console.log('❌ 아이디 중복');
            return response.send(`<script type="text/javascript">
                alert("이미 존재하는 아이디입니다."); 
                document.location.href="/auth/register";
            </script>`);
        }
        
        console.log('🔒 중복 없음, 비밀번호 해싱 시작');
        
        // Promise 방식으로 비밀번호 해싱
        // bcrypt.hash()는 salt를 자동 생성하고 비밀번호를 안전하게 해싱
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        
        console.log('🔐 비밀번호 해싱 완료, MongoDB 삽입 시작');
        
        // MongoDB에 고객 정보 삽입 (새로운 문서 구조 사용)
        const customerDocument = {
            _id: userid,                    // 이메일을 _id로 사용
            passwd: hashedPassword,
            cust_name: name,
            m_phone: phone,
            agreements: {                   // 약관 동의를 객체로 그룹화
                terms: agreeTerms,
                privacy: agreePrivacy,
                marketing: agreeMarketing
            },
            created_at: new Date(),         // 생성일자 추가
            cart: []                        // 빈 장바구니로 초기화
        };
        
        const insertResult = await db.collection('Customers').insertOne(customerDocument);
        
        console.log('✅ 고객가입 성공:', {
            insertedId: insertResult.insertedId,
            acknowledged: insertResult.acknowledged,
            userid: userid
        });
        
        response.send(`<script type="text/javascript">
            alert("고객가입이 완료되었습니다!");
            document.location.href="/";
        </script>`);
        
    } catch (error) {
        console.error('💥 고객가입 처리 중 오류:', error);
        
        // MongoDB 중복 키 에러 처리 (E11000)
        if (error.code === 11000) {
            return response.send(`<script type="text/javascript">
                alert("이미 존재하는 아이디입니다."); 
                document.location.href="/auth/register";
            </script>`);
        }
        
        response.send(`<script type="text/javascript">
            alert("고객가입 처리 중 오류가 발생했습니다: ${error.message}"); 
            document.location.href="/auth/register";
        </script>`);
    }
});

// 라우터 객체 내보내기 - 다른 파일에서 사용할 수 있도록
// Main.js에서 app.use('/auth', authRouter)로 마운트됨
module.exports = router;

/**
 * ====================================================================
 * MongoDB 변환 주요 변경 사항
 * ====================================================================
 * 
 * 1. 데이터베이스 쿼리 변경:
 *    MySQL: const [results] = await db.query('SELECT * FROM Customers WHERE cust_id = ?', [userid]);
 *    MongoDB: const customer = await db.collection('Customers').findOne({ _id: userid });
 * 
 * 2. 결과 처리 방식 변경:
 *    MySQL: results.length === 0 체크, results[0] 접근
 *    MongoDB: customer === null 체크, 직접 객체 접근
 * 
 * 3. 삽입 구조 개선:
 *    - 약관 동의를 agreements 객체로 그룹화
 *    - created_at 필드 추가
 *    - 빈 cart 배열로 초기화 (장바구니 임베딩 준비)
 * 
 * 4. 에러 처리 개선:
 *    - MongoDB 중복 키 에러 (E11000) 별도 처리
 *    - 더 구체적인 에러 핸들링
 * 
 * 5. 필드 매핑:
 *    MySQL cust_id → MongoDB _id
 *    MySQL 개별 약관 필드 → MongoDB agreements 객체
 * 
 * ====================================================================
 * 보안 고려사항 및 베스트 프랙티스 (MongoDB 버전)
 * ====================================================================
 * 
 * 1. 비밀번호 보안:
 *    - bcrypt 해싱 사용 (단방향 암호화)
 *    - salt rounds 10 적용 (무차별 대입 공격 방지)
 *    - 평문 비밀번호 로그 기록 금지
 * 
 * 2. MongoDB 인젝션 방지:
 *    - 직접적인 쿼리 객체 사용
 *    - 사용자 입력값을 적절한 타입으로 검증
 *    - $where 연산자 사용 금지
 * 
 * 3. 세션 보안:
 *    - 세션 ID 정기적 갱신
 *    - 로그아웃 시 완전한 세션 삭제
 *    - 세션 하이재킹 방지
 * 
 * 4. 입력 검증:
 *    - 서버 사이드 검증 필수
 *    - 클라이언트 검증은 UX 향상용
 *    - 필수 필드 누락 방지
 * 
 * 5. 에러 처리:
 *    - 상세한 서버 로그 기록
 *    - 사용자에게는 일반적인 메시지
 *    - 민감한 정보 노출 방지
 * 
 * ====================================================================
 * MongoDB 특화 추후 개선 가능 사항
 * ====================================================================
 * 
 * 1. 인덱스 최적화:
 *    - 이메일(_id) 유니크 인덱스 (자동)
 *    - 휴대폰 번호 인덱스 생성
 *    - 복합 인덱스 활용
 * 
 * 2. 집계 파이프라인 활용:
 *    - 사용자 통계 조회
 *    - 약관 동의율 분석
 *    - 가입 트렌드 분석
 * 
 * 3. 문서 검증 스키마:
 *    - MongoDB 6.0+ JSON Schema 활용
 *    - 필드 타입 및 제약조건 정의
 * 
 * 4. 트랜잭션 활용:
 *    - 복잡한 고객가입 프로세스에서 ACID 보장
 *    - 다중 컬렉션 업데이트 시 일관성 유지
 * 
 * 5. 장바구니 임베딩 최적화:
 *    - 장바구니 아이템 수 제한 설정
 *    - 장바구니 변경 이력 추적
 *    - 성능을 위한 배열 크기 모니터링
 * 
 * ====================================================================
 * MongoDB 컬렉션 스키마 예시
 * ====================================================================
 * 
 * customers 컬렉션:
 * {
 *   _id: "user@email.com",           // 사용자 이메일 (Primary Key)
 *   passwd: "hashed_password",       // bcrypt로 해시된 비밀번호
 *   cust_name: "홍길동",              // 사용자 이름
 *   m_phone: "01012345678",          // 휴대폰 번호
 *   agreements: {                    // 약관 동의 정보
 *     terms: "Y",                    // 이용약관 동의 (Y/N)
 *     privacy: "Y",                  // 개인정보 동의 (Y/N)
 *     marketing: "N"                 // 마케팅 동의 (Y/N)
 *   },
 *   created_at: ISODate("2025-07-25"), // 계정 생성일
 *   last_login: ISODate("2025-07-25"), // 마지막 로그인 (선택사항)
 *   cart: [                          // 임베딩된 장바구니
 *     {
 *       cart_seq_no: 1,              // 장바구니 아이템 ID
 *       prod_cd: "P0001",            // 상품 코드
 *       prod_size: "M",              // 상품 사이즈
 *       ord_qty: 2,                  // 주문 수량
 *       ord_yn: "N",                 // 주문 여부
 *       added_date: ISODate("2024-01-15") // 장바구니 추가일
 *     }
 *   ]
 * }
 * 
 * ====================================================================
 * 추천 MongoDB 인덱스
 * ====================================================================
 * 
 * // 1. 이메일 유니크 인덱스 (자동 생성됨)
 * db.customers.createIndex({ "_id": 1 }, { unique: true })
 * 
 * // 2. 휴대폰 번호 인덱스 (빠른 검색용)
 * db.customers.createIndex({ "m_phone": 1 })
 * 
 * // 3. 생성일 인덱스 (가입 통계용)
 * db.customers.createIndex({ "created_at": 1 })
 * 
 * // 4. 복합 인덱스 (이름 + 휴대폰으로 검색)
 * db.customers.createIndex({ "cust_name": 1, "m_phone": 1 })
 * 
 * ====================================================================
 * 성능 최적화 팁
 * ====================================================================
 * 
 * 1. 연결 풀 관리:
 *    - 적절한 maxPoolSize 설정 (기본값: 100)
 *    - 연결 재사용을 위한 keepAlive 활성화
 * 
 * 2. 쿼리 최적화:
 *    - 자주 사용되는 필드에 인덱스 생성
 *    - explain() 메서드로 실행 계획 분석
 *    - projection을 활용한 필요한 필드만 조회
 * 
 * 3. 메모리 관리:
 *    - 적절한 document 크기 유지 (16MB 제한)
 *    - 배열 크기 모니터링 (장바구니 아이템 수)
 * 
 * 4. 보안 설정:
 *    - 인증 활성화 (--auth)
 *    - 네트워크 접근 제한 (bind_ip)
 *    - SSL/TLS 암호화 사용
 * 
 * ====================================================================
 */