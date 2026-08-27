import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class OrderServiceTest {

    @Test
    void createOrder_withValidItems_returnsConfirmedOrder() {
        OrderService service = new OrderService();
        Order order = service.createOrder(new Item("SKU-1", 2));
        assertEquals(OrderStatus.CONFIRMED, order.getStatus());
    }

    @Test
    void createOrder_withOutOfStockItem_throwsOutOfStockException() {
        OrderService service = new OrderService();
        assertThrows(OutOfStockException.class, () -> {
            service.createOrder(new Item("SKU-OUT-OF-STOCK", 1));
        });
    }
}
