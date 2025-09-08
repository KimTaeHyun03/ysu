import os                           # 운영체제 환경변수 접근 (데이터베이스 연결정보 읽기용)
import mysql.connector              # MySQL DB 연결 및 쿼리 실행을 위한 공식 드라이버
from pymongo import MongoClient     # MongoDB/DocumentDB 연결 및 문서 조작을 위한 클라이언트
from datetime import datetime, date # 날짜/시간 처리 (이관 시점 기록용)
import hashlib                      # 해시 함수 제공 (비밀번호 암호화 등에 사용 가능)
import re                           # 정규표현식 패턴 매칭 (데이터 검증 및 변환용)

def connect_to_mysql():
    """
    MySQL RDS 데이터베이스 연결 함수
    
    Returns:
        mysql.connector.connection.MySQLConnection: MySQL 데이터베이스 연결 객체
        
    Environment Variables Required:
        - MYSQL_HOST: MySQL RDS 엔드포인트
        - MYSQL_USER: MySQL 사용자명
        - MYSQL_PASSWORD: MySQL 비밀번호
        - MYSQL_DATABASE: MySQL 데이터베이스명 (기본값: shopping_db)
    """
    # 환경 변수에서 데이터베이스 연결 정보 읽기
    # 보안을 위해 하드코딩 대신 환경 변수 사용
    mysql_config = {
        'host': os.environ.get('MYSQL_HOST'),
        'user': os.environ.get('MYSQL_USER'),
        'password': os.environ.get('MYSQL_PASSWORD'),
        'database': os.environ.get('MYSQL_DATABASE')
    }
    
    return mysql.connector.connect(**mysql_config)

def connect_to_mongodb():
    """
    MongoDB(DocumentDB) 연결 함수
    
    Returns:
        pymongo.database.Database: MongoDB(DocumentDB) 데이터베이스 객체

    Environment Variables Required:
        - MONGODB_URI: MongoDB 연결 URI
        - MONGODB_DATABASE: MongoDB 데이터베이스명 (기본값: shopping_db)
        
    Note:
        DocumentDB 사용 시 실제 연결 문자열로 변경 필요
        예: mongodb://username:password@cluster.endpoint:27017/database?tls=true&tlsCAFile=global-bundle.pem&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false
    """
    # 환경 변수에서 데이터베이스 연결 정보 읽기
    # 보안을 위해 하드코딩 대신 환경 변수 사용
    mongodb_uri = os.environ.get('MONGODB_URI')
    mongodb_database = os.environ.get('MONGODB_DATABASE')
    
    # MongoDB 로컬 연결(DocumentDB 사용 시 실제 연결 문자열로 변경 필요)
    client = MongoClient(mongodb_uri)
    
    return client[mongodb_database]  # 'shopping_db' 데이터베이스 선택

def fetch_all_data(cursor, query):
    """
    MySQL 쿼리를 실행하고 모든 결과를 반환하는 유틸리티 함수
    
    Args:
        cursor: MySQL 커서 객체 - 쿼리 실행을 담당
        query: 실행할 SQL 쿼리문 (SELECT 문)
        
    Returns:
        list: 쿼리 실행 결과를 튜플 형태의 리스트로 반환
        
    Note:
        대용량 데이터 처리 시 메모리 사용량을 고려하여 fetchmany() 사용 검토 필요
    """
    cursor.execute(query)  # SQL 쿼리 실행
    return cursor.fetchall()  # 모든 결과 반환

def migrate_Customers_collection(mysql_cursor, mongodb):
    """
    MySQL Customers 테이블을 MongoDB Customers 컬렉션으로 이관하는 함수
    각 고객의 기본 정보와 장바구니 데이터를 통합하여 하나의 문서로 구성
    
    Args:
        mysql_cursor: MySQL 커서 객체
        mongodb: MongoDB 데이터베이스 객체
        
    Data Structure:
        - 고객 기본정보 (이메일, 비밀번호, 이름, 전화번호, 동의사항)
        - 장바구니 배열 (주문된 항목과 미주문 항목 모두 포함)
    """
    print("Customers 컬렉션 이관 시작...")
    
    # 기존 Customers 컬렉션이 있다면 삭제 (Clean Start)
    mongodb.Customers.drop()
    
    # MySQL Customers 테이블에서 모든 고객 데이터 조회
    customers = fetch_all_data(mysql_cursor, "SELECT * FROM Customers")
    
    # MongoDB에 삽입할 문서들을 담을 리스트
    customers_docs = []
    
    # 각 고객별로 데이터 처리
    for customer in customers:
        # 현재 고객의 모든 장바구니 데이터 조회 (주문여부 상관없이 전체)
        cart_query = f"""
            SELECT cart_seq_no, prod_cd, prod_size, ord_qty, ord_yn
            FROM Carts 
            WHERE cust_id = '{customer[0]}'
            ORDER BY cart_seq_no
        """
        cart_items = fetch_all_data(mysql_cursor, cart_query)
        
        # MongoDB 문서 구조에 맞게 데이터 변환
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
                'added_date': datetime.now()  # 장바구니 추가 시점
            } for item in cart_items]
        }
        
        customers_docs.append(customer_doc)
    
    # MongoDB에 일괄 삽입 (Bulk Insert로 성능 최적화)
    if customers_docs:
        mongodb.Customers.insert_many(customers_docs)
    
    print(f"Customers 컬렉션 이관 완료: {len(customers_docs)}개 문서")

def migrate_Products_collection(mysql_cursor, mongodb):
    """
    MySQL Products 테이블을 MongoDB Products 컬렉션으로 이관하는 함수
    상품의 기본 정보와 상세 정보(MEDIUMTEXT)를 분리하여 구조화
    
    Args:
        mysql_cursor: MySQL 커서 객체
        mongodb: MongoDB 데이터베이스 객체
        
    Data Structure:
        - 상품 기본정보 (코드, 이름, 가격, 타입, 소재, 이미지)
        - 상세정보를 detail 객체로 분리 (대용량 데이터 격리)
    """
    print("Products 컬렉션 이관 시작...")
    
    # 기존 Products 컬렉션 삭제
    mongodb.Products.drop()
    
    # MySQL Products 테이블에서 모든 상품 데이터 조회
    products = fetch_all_data(mysql_cursor, "SELECT * FROM Products")
    
    # MongoDB에 삽입할 문서들을 담을 리스트
    products_docs = []
    
    for product in products:
        # MongoDB 문서 구조 생성
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
    
    # MongoDB에 일괄 삽입
    if products_docs:
        mongodb.Products.insert_many(products_docs)
    
    print(f"Products 컬렉션 이관 완료: {len(products_docs)}개 문서")

def migrate_Orders_collection(mysql_cursor, mongodb):
    """
    MySQL Orders와 Ord_items 테이블을 MongoDB Orders 컬렉션으로 통합 이관
    주문 기본정보와 주문상세를 하나의 문서로 결합하여 조인 비용 제거
    
    Args:
        mysql_cursor: MySQL 커서 객체
        mongodb: MongoDB 데이터베이스 객체
        
    Data Structure:
        - 주문 기본정보 (주문번호, 고객ID, 주문일자, 주문금액)
        - 주문상세 배열 (각 주문 상품 정보 + 리뷰 작성 상태)
        - 상품명 중복 저장으로 조회 성능 최적화
    """
    print("Orders 컬렉션 이관 시작...")
    
    # 기존 Orders 컬렉션 삭제
    mongodb.Orders.drop()
    
    # MySQL Orders 테이블에서 모든 주문 데이터 조회
    orders = fetch_all_data(mysql_cursor, "SELECT * FROM Orders")
    
    # MongoDB에 삽입할 문서들을 담을 리스트
    orders_docs = []
    
    for order in orders:
        ord_no = order[0]  # 주문번호 추출
        
        # 해당 주문의 상세 항목들 조회 (주문상품 정보 + 상품 기본정보 조인)
        order_items_query = f"""
            SELECT oi.ord_item_no, oi.cart_seq_no, oi.prod_cd, oi.prod_size, oi.ord_qty,
                   p.prod_name, p.price
            FROM Ord_items oi
            JOIN Products p ON oi.prod_cd = p.prod_cd
            WHERE oi.ord_no = {ord_no}
        """
        order_items = fetch_all_data(mysql_cursor, order_items_query)
        
        # 각 주문 상품별로 리뷰 작성 여부 확인 및 문서 구성
        items_with_review_status = []
        for item in order_items:
            # 해당 주문 상품에 대한 리뷰 존재 여부 확인
            review_check_query = f"""
                SELECT COUNT(*) as review_count
                FROM Prod_evals 
                WHERE ord_item_no = {item[0]}
            """
            mysql_cursor.execute(review_check_query)
            review_count = mysql_cursor.fetchone()[0]
            
            # 주문 상품 문서 구성
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
        # Orders 테이블 구조: ord_no(0), ord_date(1), ord_amount(2), cust_id(3)
        order_doc = {
            'ord_no': ord_no,                                      # 주문번호
            'ord_date': datetime.combine(order[1], datetime.min.time()) if isinstance(order[1], date) else order[1],  # MySQL date를 datetime으로 변환
            'ord_amount': int(order[2]) if order[2] else 0,        # 주문금액 (3번째 필드)
            'cust_id': order[3],                                   # 주문 고객 ID (4번째 필드)
            'items': items_with_review_status                      # 주문상세 배열 (Embedded Array)
        }
        
        orders_docs.append(order_doc)
    
    # MongoDB에 일괄 삽입
    if orders_docs:
        mongodb.Orders.insert_many(orders_docs)
    
    print(f"Orders 컬렉션 이관 완료: {len(orders_docs)}개 문서")

def migrate_Reviews_collection(mysql_cursor, mongodb):
    """
    MySQL Prod_evals 테이블을 MongoDB Reviews 컬렉션으로 이관
    상품평 정보와 관련 참조 데이터를 통합하여 조회 성능 최적화
    
    Args:
        mysql_cursor: MySQL 커서 객체
        mongodb: MongoDB 데이터베이스 객체
        
    Data Structure:
        - 리뷰 기본정보 (평점, 댓글, 작성일)
        - 관계 정보 (상품코드, 고객ID, 주문번호, 주문상품번호)
        - 고객명 전체 저장 (웹 출력시 마스킹 처리 예정)
    """
    print("Reviews 컬렉션 이관 시작...")
    
    # 기존 Reviews 컬렉션 삭제
    mongodb.Reviews.drop()
    
    # MySQL에서 상품평 데이터와 관련 정보를 조인하여 조회
    # Prod_evals + Customers + Ord_items 테이블 조인
    reviews_query = """
        SELECT pe.eval_seq_no, pe.eval_score, pe.eval_comment, pe.cust_id, 
               pe.prod_cd, pe.ord_item_no, c.cust_name,
               oi.ord_no
        FROM Prod_evals pe
        JOIN Customers c ON pe.cust_id = c.cust_id      -- 고객 이름 조회용 조인
        JOIN Ord_items oi ON pe.ord_item_no = oi.ord_item_no  -- 주문번호 조회용 조인
    """
    reviews = fetch_all_data(mysql_cursor, reviews_query)
    
    # MongoDB에 삽입할 문서들을 담을 리스트
    reviews_docs = []
    
    for review in reviews:
        # MongoDB 리뷰 문서 구성
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
    
    # MongoDB에 일괄 삽입
    if reviews_docs:
        mongodb.Reviews.insert_many(reviews_docs)
    
    print(f"Reviews 컬렉션 이관 완료: {len(reviews_docs)}개 문서")

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
    print("인덱스 생성 시작...")
    
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
    
    print("인덱스 생성 완료")

def validate_migration(mysql_cursor, mongodb):
    """
    데이터 이관 결과의 정확성을 검증하는 함수
    MySQL과 MongoDB 간의 데이터 일관성 및 정합성 확인
    
    Args:
        mysql_cursor: MySQL 커서 객체
        mongodb: MongoDB 데이터베이스 객체
        
    Validation Points:
        1. 레코드 수 일치 여부 확인
        2. 샘플 데이터 구조 검증
        3. 관계형 데이터의 올바른 변환 확인
    """
    print("\n=== 이관 결과 검증 ===")
    
    # 1. 테이블/컬렉션별 레코드 수 비교
    # Customers -> Customers
    mysql_cursor.execute("SELECT COUNT(*) FROM Customers")
    mysql_customers_count = mysql_cursor.fetchone()[0]
    mongo_customers_count = mongodb.Customers.count_documents({})
    print(f"Customers: MySQL({mysql_customers_count}) vs MongoDB({mongo_customers_count})")
    
    # Products -> Products
    mysql_cursor.execute("SELECT COUNT(*) FROM Products")
    mysql_products_count = mysql_cursor.fetchone()[0]
    mongo_products_count = mongodb.Products.count_documents({})
    print(f"Products: MySQL({mysql_products_count}) vs MongoDB({mongo_products_count})")
    
    # Orders -> Orders
    mysql_cursor.execute("SELECT COUNT(*) FROM Orders")
    mysql_orders_count = mysql_cursor.fetchone()[0]
    mongo_orders_count = mongodb.Orders.count_documents({})
    print(f"Orders: MySQL({mysql_orders_count}) vs MongoDB({mongo_orders_count})")
    
    # Prod_evals -> Reviews
    mysql_cursor.execute("SELECT COUNT(*) FROM Prod_evals")
    mysql_reviews_count = mysql_cursor.fetchone()[0]
    mongo_reviews_count = mongodb.Reviews.count_documents({})
    print(f"Reviews: MySQL({mysql_reviews_count}) vs MongoDB({mongo_reviews_count})")
    
    # 2. 샘플 데이터 구조 및 내용 검증
    print("\n=== 샘플 데이터 확인 ===")
    
    # 사용자 샘플 데이터 확인
    sample_customer = mongodb.Customers.find_one()
    if sample_customer:
        total_cart_items = len(sample_customer['cart'])  # 전체 장바구니 항목 수
        # 주문되지 않은 활성 장바구니 항목 수 계산
        active_cart_items = len([item for item in sample_customer['cart'] if item['ord_yn'] == 'N'])
        print(f"샘플 고객: {sample_customer['_id']}, 전체 장바구니: {total_cart_items}, 활성 장바구니: {active_cart_items}")
    
    # 주문 샘플 데이터 확인
    sample_order = mongodb.Orders.find_one()
    if sample_order:
        print(f"샘플 주문: {sample_order['ord_no']}, 주문 아이템 수: {len(sample_order['items'])}")

def main():
    """
    MySQL에서 MongoDB로의 전체 데이터 이관을 실행하는 메인 함수
    
    Process Flow:
        1. 데이터베이스 연결 설정
        2. 순서대로 컬렉션 이관 (참조 관계 고려)
        3. 성능 최적화를 위한 인덱스 생성
        4. 이관 결과 검증
        5. 리소스 정리
        
    Error Handling:
        - 예외 발생시 오류 메시지 출력
        - finally 블록으로 연결 리소스 확실히 정리
    """
    print("MySQL to MongoDB 이관 프로세스 시작")
    print("=" * 50)
    
    # 데이터베이스 연결 설정
    mysql_conn = connect_to_mysql()      # MySQL 연결
    mysql_cursor = mysql_conn.cursor()   # MySQL 커서 생성
    mongodb = connect_to_mongodb()       # MongoDB 연결
    
    try:
        # 1. Products 컬렉션 이관 (다른 컬렉션에서 참조하므로 우선 실행)
        migrate_Products_collection(mysql_cursor, mongodb)
        
        # 2. Customers 컬렉션 이관 (Customers 컬렉션으로)
        migrate_Customers_collection(mysql_cursor, mongodb)
        
        # 3. Orders 컬렉션 이관 (Orders + Ord_items 통합)
        migrate_Orders_collection(mysql_cursor, mongodb)
        
        # 4. Reviews 컬렉션 이관 (Prod_evals 변환)
        migrate_Reviews_collection(mysql_cursor, mongodb)
        
        # 5. 성능 최적화를 위한 인덱스 생성
        create_indexes(mongodb)
        
        # 6. 이관 결과 검증 및 확인
        validate_migration(mysql_cursor, mongodb)
        
        print("\n" + "=" * 50)
        print("이관 프로세스 완료!")
        
    except Exception as e:
        # 이관 중 발생한 오류 처리
        print(f"이관 중 오류 발생: {str(e)}")
        # 실제 운영 환경에서는 로깅 시스템 사용 권장
        
    finally:
        # 데이터베이스 연결 리소스 정리 (메모리 누수 방지)
        mysql_cursor.close()
        mysql_conn.close()
        # MongoDB 연결은 자동으로 관리됨

# 스크립트가 직접 실행될 때만 main() 함수 호출
# 모듈로 import될 때는 실행되지 않음
if __name__ == "__main__":
    main()