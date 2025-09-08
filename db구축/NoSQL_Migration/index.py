import json                    # JSON 데이터 직렬화/역직렬화 (Lambda 응답 형식 생성용)
import os                      # 운영체제 환경변수 접근 (데이터베이스 연결정보 읽기용)
import logging                 # 구조화된 로깅 시스템 (CloudWatch 로그 출력용)
from datetime import datetime, date  # 날짜/시간 처리 (이관 시점 기록 및 MySQL date 타입 변환용)
import mysql.connector         # MySQL 데이터베이스 연결 및 쿼리 실행을 위한 공식 드라이버
from pymongo import MongoClient # MongoDB/DocumentDB 연결 및 문서 조작을 위한 클라이언트

# Lambda 로깅 설정 - CloudWatch에서 모니터링 가능
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """
    AWS Lambda 메인 핸들러 함수
    MySQL에서 MongoDB로 데이터 이관을 수행하는 서버리스 함수
    
    Args:
        event (dict): Lambda 이벤트 객체
            - collections (list): 이관할 컬렉션 목록 ['Products', 'Customers', 'Orders', 'Reviews']
            - create_indexes (bool): 인덱스 생성 여부 (기본값: True)
            - validate (bool): 이관 결과 검증 여부 (기본값: True)
        context: Lambda 런타임 컨텍스트 객체
        
    Returns:
        dict: API Gateway 호환 응답 형식
            - statusCode: HTTP 상태 코드
            - body: JSON 문자열 형태의 응답 본문
            
    Environment Variables Required:
        - MYSQL_HOST: MySQL RDS 엔드포인트
        - MYSQL_USER: MySQL 사용자명
        - MYSQL_PASSWORD: MySQL 비밀번호
        - MYSQL_DATABASE: MySQL 데이터베이스명 (기본값: shopping_db)
        - MONGODB_URI: MongoDB 연결 URI
        - MONGODB_DATABASE: MongoDB 데이터베이스명 (기본값: shopping_db)
    """
    try:
        logger.info("=== MySQL to MongoDB 이관 프로세스 시작 ===")
        logger.info(f"Lambda 요청 ID: {context.aws_request_id}")
        logger.info(f"함수명: {context.function_name}")
        logger.info(f"남은 실행시간: {context.get_remaining_time_in_millis()}ms")
        
        # 환경 변수에서 데이터베이스 연결 정보 읽기
        # 보안을 위해 하드코딩 대신 환경 변수 사용
        mysql_config = {
            'host': os.environ.get('MYSQL_HOST'),
            'user': os.environ.get('MYSQL_USER'),
            'password': os.environ.get('MYSQL_PASSWORD'),
            'database': os.environ.get('MYSQL_DATABASE', 'shopping_db')
        }
        
        mongodb_uri = os.environ.get('MONGODB_URI')
        mongodb_database = os.environ.get('MONGODB_DATABASE', 'shopping_db')
        
        # 필수 환경 변수 검증 - Lambda 배포 시 설정 누락 방지
        required_vars = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MONGODB_URI']
        missing_vars = [var for var in required_vars if not os.environ.get(var)]
        if missing_vars:
            raise ValueError(f"필수 환경 변수가 누락되었습니다: {missing_vars}")
        
        logger.info(f"MySQL 연결 대상: {mysql_config['host']}")
        logger.info(f"MongoDB 연결 대상: {mongodb_uri.split('@')[1] if '@' in mongodb_uri else mongodb_uri}")
        
        # 데이터베이스 연결 수립
        # MySQL 연결 (RDS 또는 온프레미스)
        mysql_conn = mysql.connector.connect(**mysql_config)
        mysql_cursor = mysql_conn.cursor()
        logger.info("MySQL 연결 성공")
        
        # MongoDB 연결 (DocumentDB, Atlas, 또는 로컬)
        mongo_client = MongoClient(mongodb_uri)
        mongodb = mongo_client[mongodb_database]
        logger.info("MongoDB 연결 성공")
        
        # 이벤트에서 이관 옵션 파싱 (기본값 설정)
        collections_to_migrate = event.get('collections', ['Products', 'Customers', 'Orders', 'Reviews'])
        create_indexes_flag = event.get('create_indexes', True)
        validate_flag = event.get('validate', True)
        
        logger.info(f"이관 대상 컬렉션: {collections_to_migrate}")
        
        migration_results = {}
        total_start_time = datetime.now()
        
        # 각 컬렉션별 순차 이관 수행
        # 참조 관계를 고려하여 Products를 먼저 이관
        for collection in collections_to_migrate:
            collection_start_time = datetime.now()
            
            if collection == 'Products':
                result = migrate_products_collection(mysql_cursor, mongodb)
                migration_results['Products'] = result
                
            elif collection == 'Customers':
                result = migrate_customers_collection(mysql_cursor, mongodb)
                migration_results['Customers'] = result
                
            elif collection == 'Orders':
                result = migrate_orders_collection(mysql_cursor, mongodb)
                migration_results['Orders'] = result
                
            elif collection == 'Reviews':
                result = migrate_reviews_collection(mysql_cursor, mongodb)
                migration_results['Reviews'] = result
            
            # 각 컬렉션별 처리 시간 기록
            collection_duration = (datetime.now() - collection_start_time).total_seconds()
            migration_results[collection]['duration_seconds'] = collection_duration
            logger.info(f"{collection} 컬렉션 이관 소요시간: {collection_duration:.2f}초")
        
        # 성능 최적화를 위한 인덱스 생성 (옵션)
        if create_indexes_flag:
            index_start_time = datetime.now()
            create_indexes(mongodb)
            index_duration = (datetime.now() - index_start_time).total_seconds()
            migration_results['indexes_created'] = True
            migration_results['index_creation_duration'] = index_duration
            logger.info(f"인덱스 생성 소요시간: {index_duration:.2f}초")
        
        # 데이터 정합성 검증 수행 (옵션)
        if validate_flag:
            validation_start_time = datetime.now()
            validation_results = validate_migration(mysql_cursor, mongodb)
            validation_duration = (datetime.now() - validation_start_time).total_seconds()
            migration_results['validation'] = validation_results
            migration_results['validation_duration'] = validation_duration
            logger.info(f"검증 소요시간: {validation_duration:.2f}초")
        
        # 전체 처리 시간 계산
        total_duration = (datetime.now() - total_start_time).total_seconds()
        migration_results['total_duration_seconds'] = total_duration
        
        # 데이터베이스 연결 리소스 정리
        mysql_cursor.close()
        mysql_conn.close()
        mongo_client.close()
        logger.info("데이터베이스 연결 정리 완료")
        
        logger.info(f"=== 이관 프로세스 완료 (총 소요시간: {total_duration:.2f}초) ===")
        
        # Lambda 성공 응답 반환
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'  # CORS 설정 (필요시)
            },
            'body': json.dumps({
                'success': True,
                'message': '데이터 이관이 성공적으로 완료되었습니다.',
                'results': migration_results,
                'request_id': context.aws_request_id,
                'timestamp': datetime.now().isoformat()
            }, ensure_ascii=False, indent=2)
        }
        
    except Exception as e:
        # 예외 발생 시 상세 로깅 및 에러 응답
        logger.error(f"이관 중 오류 발생: {str(e)}")
        logger.error(f"오류 타입: {type(e).__name__}")
        
        # 연결이 열려있다면 정리
        try:
            if 'mysql_cursor' in locals():
                mysql_cursor.close()
            if 'mysql_conn' in locals():
                mysql_conn.close()
            if 'mongo_client' in locals():
                mongo_client.close()
        except:
            pass
        
        # Lambda 에러 응답 반환
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json'
            },
            'body': json.dumps({
                'success': False,
                'error': str(e),
                'error_type': type(e).__name__,
                'request_id': context.aws_request_id,
                'timestamp': datetime.now().isoformat()
            }, ensure_ascii=False, indent=2)
        }

def migrate_products_collection(mysql_cursor, mongodb):
    """
    MySQL Products 테이블을 MongoDB Products 컬렉션으로 이관
    상품의 기본 정보와 상세 정보(MEDIUMTEXT)를 분리하여 구조화
    
    Args:
        mysql_cursor: MySQL 데이터베이스 커서
        mongodb: MongoDB 데이터베이스 객체
        
    Returns:
        dict: 이관 결과 정보 (문서 수, 처리 시간 등)
        
    Data Structure:
        - 상품 기본정보 (코드, 이름, 가격, 타입, 소재, 이미지)
        - 상세정보를 detail 객체로 분리 (대용량 데이터 격리)
    """
    logger.info("Products 컬렉션 이관 시작")
    
    # 기존 Products 컬렉션 삭제 (Clean Start)
    mongodb.Products.drop()
    logger.info("기존 Products 컬렉션 삭제 완료")
    
    # MySQL Products 테이블에서 모든 상품 데이터 조회
    mysql_cursor.execute("SELECT * FROM Products")
    products = mysql_cursor.fetchall()
    logger.info(f"MySQL에서 {len(products)}개 상품 데이터 조회")
    
    products_docs = []
    for product in products:
        # MongoDB 문서 구조로 변환
        # 메인 화면 성능 최적화를 위해 상품소개를 detail 객체로 분리
        product_doc = {
            '_id': product[0],                                    # 상품코드를 _id로 사용
            'prod_name': product[1],                              # 상품명
            'price': int(product[2]),                             # 가격 (Decimal을 int로 변환)
            'prod_type': product[3],                              # 상품유형 (상의, 하의 등)
            'material': product[4],                               # 소재 (면, 폴리에스터 등)
            'prod_img': product[5],                               # 상품이미지 파일명
            'detail': {                                           # 상세정보를 별도 객체로 분리
                'prod_intro': product[6] if product[6] else ""    # 상품소개 (MEDIUMTEXT, null 처리)
            }
        }
        products_docs.append(product_doc)
    
    # MongoDB에 벌크 삽입 (성능 최적화)
    if products_docs:
        result = mongodb.Products.insert_many(products_docs)
        logger.info(f"MongoDB에 {len(result.inserted_ids)}개 상품 문서 삽입 완료")
    
    logger.info(f"Products 컬렉션 이관 완료: {len(products_docs)}개 문서")
    return {
        'count': len(products_docs),
        'collection_name': 'Products',
        'mysql_records': len(products),
        'mongodb_documents': len(products_docs)
    }

def migrate_customers_collection(mysql_cursor, mongodb):
    """
    MySQL Customers 테이블을 MongoDB Customers 컬렉션으로 이관
    각 고객의 기본 정보와 장바구니 데이터를 통합하여 하나의 문서로 구성
    
    Args:
        mysql_cursor: MySQL 데이터베이스 커서
        mongodb: MongoDB 데이터베이스 객체
        
    Returns:
        dict: 이관 결과 정보
        
    Data Structure:
        - 고객 기본정보 (이메일, 비밀번호, 이름, 전화번호, 동의사항)
        - 장바구니 배열 (주문된 항목과 미주문 항목 모두 포함)
    """
    logger.info("Customers 컬렉션 이관 시작")
    
    # 기존 Customers 컬렉션 삭제 (Clean Start)
    mongodb.Customers.drop()
    logger.info("기존 Customers 컬렉션 삭제 완료")
    
    # MySQL Customers 테이블에서 모든 고객 데이터 조회
    mysql_cursor.execute("SELECT * FROM Customers")
    customers = mysql_cursor.fetchall()
    logger.info(f"MySQL에서 {len(customers)}개 고객 데이터 조회")
    
    customers_docs = []
    total_cart_items = 0
    
    # 각 고객별로 데이터 처리
    for customer in customers:
        # 현재 고객의 모든 장바구니 데이터 조회
        # 주문 여부와 관계없이 전체 이력을 포함 (웹에서 필터링)
        cart_query = f"""
            SELECT cart_seq_no, prod_cd, prod_size, ord_qty, ord_yn
            FROM Carts 
            WHERE cust_id = '{customer[0]}'
            ORDER BY cart_seq_no
        """
        mysql_cursor.execute(cart_query)
        cart_items = mysql_cursor.fetchall()
        total_cart_items += len(cart_items)
        
        # MongoDB 문서 구조에 맞게 데이터 변환
        # NoSQL의 비정규화 특성을 활용하여 관련 데이터를 하나의 문서로 통합
        customer_doc = {
            '_id': customer[0],          # 이메일을 MongoDB의 _id로 사용 (중복 방지 및 빠른 조회)
            'passwd': customer[1],       # 비밀번호 (실제 운영시 해싱 처리 필요)
            'cust_name': customer[2],    # 고객명
            'm_phone': customer[3],      # 휴대폰번호
            'agreements': {              # 동의사항을 중첩 객체로 구조화
                'terms': customer[4],    # 이용약관 동의 (Y/N)
                'privacy': customer[5],  # 개인정보활용 동의 (Y/N)
                'marketing': customer[6] # 마케팅수신 동의 (Y/N)
            },
            'created_at': datetime.now(), # 이관 시점을 생성일로 기록
            # 장바구니 데이터를 배열 형태로 내장 (Embedded Document)
            'cart': [{
                'cart_seq_no': item[0],   # 장바구니 순번
                'prod_cd': item[1],       # 상품코드
                'prod_size': item[2],     # 상품사이즈
                'ord_qty': item[3],       # 주문수량
                'ord_yn': item[4],        # 주문여부 (Y: 주문완료, N: 장바구니 상태)
                'added_date': datetime.now()  # 장바구니 추가 시점 (이관 시점으로 기록)
            } for item in cart_items]
        }
        customers_docs.append(customer_doc)
    
    # MongoDB에 벌크 삽입 (성능 최적화)
    if customers_docs:
        result = mongodb.Customers.insert_many(customers_docs)
        logger.info(f"MongoDB에 {len(result.inserted_ids)}개 고객 문서 삽입 완료")
    
    logger.info(f"Customers 컬렉션 이관 완료: {len(customers_docs)}개 문서, {total_cart_items}개 장바구니 항목")
    return {
        'count': len(customers_docs),
        'collection_name': 'Customers',
        'mysql_records': len(customers),
        'mongodb_documents': len(customers_docs),
        'total_cart_items': total_cart_items
    }

def migrate_orders_collection(mysql_cursor, mongodb):
    """
    MySQL Orders와 Ord_items 테이블을 MongoDB Orders 컬렉션으로 통합 이관
    주문 기본정보와 주문상세를 하나의 문서로 결합하여 조인 비용 제거
    
    Args:
        mysql_cursor: MySQL 데이터베이스 커서
        mongodb: MongoDB 데이터베이스 객체
        
    Returns:
        dict: 이관 결과 정보
        
    Data Structure:
        - 주문 기본정보 (주문번호, 고객ID, 주문일자, 주문금액)
        - 주문상세 배열 (각 주문 상품 정보 + 리뷰 작성 상태)
        - 상품명 중복 저장으로 조회 성능 최적화
    """
    logger.info("Orders 컬렉션 이관 시작")
    
    # 기존 Orders 컬렉션 삭제 (Clean Start)
    mongodb.Orders.drop()
    logger.info("기존 Orders 컬렉션 삭제 완료")
    
    # MySQL Orders 테이블에서 모든 주문 데이터 조회
    mysql_cursor.execute("SELECT * FROM Orders")
    orders = mysql_cursor.fetchall()
    logger.info(f"MySQL에서 {len(orders)}개 주문 데이터 조회")
    
    orders_docs = []
    total_order_items = 0
    
    for order in orders:
        ord_no = order[0]  # 주문번호 추출
        
        # 해당 주문의 상세 항목들 조회 (주문상품 정보 + 상품 기본정보 조인)
        # 성능 최적화를 위해 상품명을 미리 조인하여 가져옴
        order_items_query = f"""
            SELECT oi.ord_item_no, oi.cart_seq_no, oi.prod_cd, oi.prod_size, oi.ord_qty,
                   p.prod_name, p.price
            FROM Ord_items oi
            JOIN Products p ON oi.prod_cd = p.prod_cd
            WHERE oi.ord_no = {ord_no}
        """
        mysql_cursor.execute(order_items_query)
        order_items = mysql_cursor.fetchall()
        total_order_items += len(order_items)
        
        # 각 주문 상품별로 리뷰 작성 여부 확인 및 문서 구성
        items_with_review_status = []
        for item in order_items:
            # 해당 주문 상품에 대한 리뷰 존재 여부 확인 (UX 개선용)
            review_check_query = f"""
                SELECT COUNT(*) as review_count
                FROM Prod_evals 
                WHERE ord_item_no = {item[0]}
            """
            mysql_cursor.execute(review_check_query)
            review_count = mysql_cursor.fetchone()[0]
            
            # 주문 상품 문서 구성 (Embedded Document)
            item_doc = {
                'ord_item_no': item[0],                    # 주문상품번호
                'prod_cd': item[2],                        # 상품코드
                'prod_name': item[5],                      # 상품명 (성능을 위한 의도적 중복 저장)
                'prod_size': item[3],                      # 상품사이즈
                'unit_price': int(item[6]),                # 단가
                'ord_qty': item[4],                        # 주문수량
                'cart_seq_no': item[1],                    # 원본 장바구니 순번 (추적용)
                'review_written': review_count > 0         # 리뷰 작성 완료 여부 (UX 개선용)
            }
            items_with_review_status.append(item_doc)
        
        # MongoDB 주문 문서 생성 (주문 기본정보 + 주문상세 배열)
        # MySQL date 타입을 MongoDB datetime 타입으로 안전하게 변환
        order_doc = {
            'ord_no': ord_no,                                      # 주문번호
            'ord_date': datetime.combine(order[1], datetime.min.time()) if isinstance(order[1], date) else order[1],  # MySQL date를 datetime으로 변환
            'ord_amount': int(order[2]) if order[2] else 0,        # 주문금액
            'cust_id': order[3],                                   # 주문 고객 ID
            'items': items_with_review_status                      # 주문상세 배열 (Embedded Array)
        }
        orders_docs.append(order_doc)
    
    # MongoDB에 벌크 삽입 (성능 최적화)
    if orders_docs:
        result = mongodb.Orders.insert_many(orders_docs)
        logger.info(f"MongoDB에 {len(result.inserted_ids)}개 주문 문서 삽입 완료")
    
    logger.info(f"Orders 컬렉션 이관 완료: {len(orders_docs)}개 문서, {total_order_items}개 주문 상품")
    return {
        'count': len(orders_docs),
        'collection_name': 'Orders',
        'mysql_records': len(orders),
        'mongodb_documents': len(orders_docs),
        'total_order_items': total_order_items
    }

def migrate_reviews_collection(mysql_cursor, mongodb):
    """
    MySQL Prod_evals 테이블을 MongoDB Reviews 컬렉션으로 이관
    상품평 정보와 관련 참조 데이터를 통합하여 조회 성능 최적화
    
    Args:
        mysql_cursor: MySQL 데이터베이스 커서
        mongodb: MongoDB 데이터베이스 객체
        
    Returns:
        dict: 이관 결과 정보
        
    Data Structure:
        - 리뷰 기본정보 (평점, 댓글, 작성일)
        - 관계 정보 (상품코드, 고객ID, 주문번호, 주문상품번호)
        - 고객명 전체 저장 (웹 출력시 마스킹 처리 예정)
    """
    logger.info("Reviews 컬렉션 이관 시작")
    
    # 기존 Reviews 컬렉션 삭제 (Clean Start)
    mongodb.Reviews.drop()
    logger.info("기존 Reviews 컬렉션 삭제 완료")
    
    # MySQL에서 상품평 데이터와 관련 정보를 조인하여 조회
    # 여러 테이블 조인으로 필요한 모든 정보를 한 번에 가져옴
    reviews_query = """
        SELECT pe.eval_seq_no, pe.eval_score, pe.eval_comment, pe.cust_id, 
               pe.prod_cd, pe.ord_item_no, c.cust_name,
               oi.ord_no
        FROM Prod_evals pe
        JOIN Customers c ON pe.cust_id = c.cust_id      -- 고객 이름 조회용 조인
        JOIN Ord_items oi ON pe.ord_item_no = oi.ord_item_no  -- 주문번호 조회용 조인
    """
    mysql_cursor.execute(reviews_query)
    reviews = mysql_cursor.fetchall()
    logger.info(f"MySQL에서 {len(reviews)}개 리뷰 데이터 조회")
    
    reviews_docs = []
    for review in reviews:
        # MongoDB 리뷰 문서 구성
        # 조인 결과를 활용하여 참조 정보까지 포함한 완전한 문서 생성
        review_doc = {
            'prod_cd': review[4],                               # 상품코드
            'cust_id': review[3],                               # 고객ID (이메일)
            'cust_name': review[6],                             # 고객명 전체 저장 (웹에서 마스킹 처리)
            'ord_no': review[7],                                # 주문번호 (리뷰와 주문 연관관계 유지)
            'ord_item_no': review[5],                           # 주문상품번호 (세부 추적용)
            'eval_score': review[1],                            # 평점 (1-5점)
            'eval_comment': review[2] if review[2] else "",     # 리뷰 내용 (null 처리)
            'eval_date': datetime.now()                         # 리뷰 작성일 (이관 시점으로 기록)
        }
        reviews_docs.append(review_doc)
    
    # MongoDB에 벌크 삽입 (성능 최적화)
    if reviews_docs:
        result = mongodb.Reviews.insert_many(reviews_docs)
        logger.info(f"MongoDB에 {len(result.inserted_ids)}개 리뷰 문서 삽입 완료")
    
    logger.info(f"Reviews 컬렉션 이관 완료: {len(reviews_docs)}개 문서")
    return {
        'count': len(reviews_docs),
        'collection_name': 'Reviews',
        'mysql_records': len(reviews),
        'mongodb_documents': len(reviews_docs)
    }

def create_indexes(mongodb):
    """
    MongoDB 컬렉션들에 성능 최적화를 위한 인덱스 생성
    각 컬렉션의 주요 쿼리 패턴을 분석하여 적절한 인덱스 설계
    
    Args:
        mongodb: MongoDB 데이터베이스 객체
        
    Index Strategy:
        - 복합 인덱스: 여러 필드를 함께 사용하는 쿼리용
        - 텍스트 인덱스: 상품명 검색용
        - 정렬 인덱스: 날짜순 정렬 쿼리용
    """
    logger.info("인덱스 생성 시작")
    
    try:
        # Products 컬렉션 인덱스
        # 1. 상품 타입별 가격 정렬 쿼리용 복합 인덱스
        mongodb.Products.create_index([("prod_type", 1), ("price", 1)])
        # 2. 상품명 전문 검색용 텍스트 인덱스
        mongodb.Products.create_index([("prod_name", "text")])
        
        # Orders 컬렉션 인덱스
        # 1. 고객별 주문내역 조회용 (최신순 정렬)
        mongodb.Orders.create_index([("cust_id", 1), ("ord_date", -1)])
        # 2. 리뷰 미작성 상품 조회용 복합 인덱스
        mongodb.Orders.create_index([("items.review_written", 1), ("cust_id", 1)])
        
        # Reviews 컬렉션 인덱스
        # 1. 상품별 리뷰 조회용 (최신순 정렬)
        mongodb.Reviews.create_index([("prod_cd", 1), ("eval_date", -1)])
        # 2. 고객별 리뷰 조회용
        mongodb.Reviews.create_index([("cust_id", 1)])
        
        logger.info("인덱스 생성 완료")
        
    except Exception as e:
        # 인덱스 생성 실패는 치명적이지 않으므로 경고 로그만 남기고 계속 진행
        logger.warning(f"인덱스 생성 중 오류: {str(e)}")

def validate_migration(mysql_cursor, mongodb):
    """
    데이터 이관 결과의 정확성을 검증하는 함수
    MySQL과 MongoDB 간의 데이터 일관성 및 정합성 확인
    
    Args:
        mysql_cursor: MySQL 커서 객체
        mongodb: MongoDB 데이터베이스 객체
        
    Returns:
        dict: 검증 결과 정보
        
    Validation Points:
        1. 레코드 수 일치 여부 확인
        2. 샘플 데이터 구조 검증
        3. 관계형 데이터의 올바른 변환 확인
    """
    logger.info("이관 결과 검증 시작")
    
    validation_results = {}
    
    try:
        # 1. 테이블/컬렉션별 레코드 수 비교
        # Customers -> Customers
        mysql_cursor.execute("SELECT COUNT(*) FROM Customers")
        mysql_customers_count = mysql_cursor.fetchone()[0]
        mongo_customers_count = mongodb.Customers.count_documents({})
        validation_results['customers'] = {
            'mysql_count': mysql_customers_count,
            'mongodb_count': mongo_customers_count,
            'match': mysql_customers_count == mongo_customers_count
        }
        logger.info(f"Customers: MySQL({mysql_customers_count}) vs MongoDB({mongo_customers_count})")
        
        # Products -> Products
        mysql_cursor.execute("SELECT COUNT(*) FROM Products")
        mysql_products_count = mysql_cursor.fetchone()[0]
        mongo_products_count = mongodb.Products.count_documents({})
        validation_results['products'] = {
            'mysql_count': mysql_products_count,
            'mongodb_count': mongo_products_count,
            'match': mysql_products_count == mongo_products_count
        }
        logger.info(f"Products: MySQL({mysql_products_count}) vs MongoDB({mongo_products_count})")
        
        # Orders -> Orders
        mysql_cursor.execute("SELECT COUNT(*) FROM Orders")
        mysql_orders_count = mysql_cursor.fetchone()[0]
        mongo_orders_count = mongodb.Orders.count_documents({})
        validation_results['orders'] = {
            'mysql_count': mysql_orders_count,
            'mongodb_count': mongo_orders_count,
            'match': mysql_orders_count == mongo_orders_count
        }
        logger.info(f"Orders: MySQL({mysql_orders_count}) vs MongoDB({mongo_orders_count})")
        
        # Prod_evals -> Reviews
        mysql_cursor.execute("SELECT COUNT(*) FROM Prod_evals")
        mysql_reviews_count = mysql_cursor.fetchone()[0]
        mongo_reviews_count = mongodb.Reviews.count_documents({})
        validation_results['reviews'] = {
            'mysql_count': mysql_reviews_count,
            'mongodb_count': mongo_reviews_count,
            'match': mysql_reviews_count == mongo_reviews_count
        }
        logger.info(f"Reviews: MySQL({mysql_reviews_count}) vs MongoDB({mongo_reviews_count})")
        
        # 2. 샘플 데이터 구조 및 내용 검증
        logger.info("샘플 데이터 확인")
        
        # 사용자 샘플 데이터 확인
        sample_customer = mongodb.Customers.find_one()
        if sample_customer:
            total_cart_items = len(sample_customer['cart'])  # 전체 장바구니 항목 수
            # 주문되지 않은 활성 장바구니 항목 수 계산
            active_cart_items = len([item for item in sample_customer['cart'] if item['ord_yn'] == 'N'])
            logger.info(f"샘플 고객: {sample_customer['_id']}, 전체 장바구니: {total_cart_items}, 활성 장바구니: {active_cart_items}")
        
        # 주문 샘플 데이터 확인
        sample_order = mongodb.Orders.find_one()
        if sample_order:
            logger.info(f"샘플 주문: {sample_order['ord_no']}, 주문 아이템 수: {len(sample_order['items'])}")
        
        # 전체 성공 여부
        all_match = (validation_results['customers']['match'] and 
                    validation_results['products']['match'] and 
                    validation_results['orders']['match'] and 
                    validation_results['reviews']['match'])
        validation_results['overall_success'] = all_match
        
        logger.info("이관 결과 검증 완료")
        
    except Exception as e:
        logger.error(f"검증 중 오류: {str(e)}")
        validation_results['error'] = str(e)
        validation_results['overall_success'] = False
    
    return validation_results